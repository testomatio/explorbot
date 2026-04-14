import { tool } from 'ai';
import dedent from 'dedent';
import { z } from 'zod';
import { ActionResult } from '../action-result.ts';
import { setActivity } from '../activity.ts';
import type { ExperienceTracker } from '../experience-tracker.ts';
import type Explorer from '../explorer.ts';
import type { KnowledgeTracker } from '../knowledge-tracker.ts';
import { Observability } from '../observability.ts';
import { Plan, Test, TestResult } from '../test-plan.ts';
import { collectInteractiveNodes } from '../utils/aria.ts';
import { HooksRunner } from '../utils/hooks-runner.ts';
import { createDebug, tag } from '../utils/logger.ts';
import { loop, pause } from '../utils/loop.ts';
import { WebElement } from '../utils/web-element.ts';
import type { Agent } from './agent.ts';
import type { Conversation } from './conversation.ts';
import type { Navigator } from './navigator.ts';
import type { Provider } from './provider.ts';
import { locatorRule } from './rules.ts';
import { TaskAgent, isInteractive } from './task-agent.ts';
import { createCodeceptJSTools } from './tools.ts';

const debugLog = createDebug('explorbot:driller');

interface ComponentInfo {
  id: string;
  name: string;
  role: string;
  locator: string;
  preferredCode: string;
  eidx: string;
  description: string;
  html: string;
  text: string;
  tag: string;
  classes: string[];
  context: string;
  variant: string;
  placeholder: string;
  disabled: boolean;
  ariaMatches: string[];
}

interface InteractionResult {
  componentId: string;
  component: string;
  action: string;
  result: 'success' | 'failed' | 'unknown';
  description: string;
  code?: string;
}

interface ComponentTest extends Test {
  component?: ComponentInfo;
  interactions?: InteractionResult[];
}

interface DrillOptions {
  knowledgePath?: string;
  maxComponents?: number;
  interactive?: boolean;
}

export class Driller extends TaskAgent implements Agent {
  protected readonly ACTION_TOOLS = ['click', 'pressKey', 'form'];
  emoji = 'D';
  private explorer: Explorer;
  private provider: Provider;
  private navigator: Navigator;
  private hooksRunner: HooksRunner;
  private currentPlan?: Plan;
  private currentConversation: Conversation | null = null;
  private allResults: InteractionResult[] = [];
  private verifiedAction: { componentId: string; toolName: string; code?: string; canonicalCode?: string } | null = null;
  private pendingNestedContext: string | null = null;

  MAX_COMPONENT_ITERATIONS = 12;

  constructor(explorer: Explorer, provider: Provider, navigator: Navigator) {
    super();
    this.explorer = explorer;
    this.provider = provider;
    this.navigator = navigator;
    this.hooksRunner = new HooksRunner(explorer, explorer.getConfig());
  }

  protected getNavigator(): Navigator {
    return this.navigator;
  }

  protected getExperienceTracker(): ExperienceTracker {
    return this.explorer.getStateManager().getExperienceTracker();
  }

  protected getKnowledgeTracker(): KnowledgeTracker {
    return this.explorer.getKnowledgeTracker();
  }

  protected getProvider(): Provider {
    return this.provider;
  }

  getSystemMessage(component?: ComponentInfo): string {
    const currentUrl = this.explorer.getStateManager().getCurrentState()?.url;
    const customPrompt = this.provider.getSystemPromptForAgent('driller', currentUrl);

    return dedent`
    <role>
    You are a senior QA automation engineer focused on drilling one UI component at a time.
    Your goal is to discover reusable interactions for the component using HTML and ARIA only.
    </role>

    <approach>
    1. Study the provided page HTML and ARIA snapshot
    2. Focus on exactly one component at a time
    3. Try the smallest useful interaction using click, form, and pressKey tools
    4. Restore the page state after navigations, popups, or destructive attempts
    5. Record reusable interactions with drill_record
    6. Call drill_done only after you have finished exploring the component
    </approach>

    <rules>
    - Never ask for researcher output or rely on page UI maps
    - Work from <page_html>, <page_aria>, and the provided component HTML snippet
    - Never use data-explorbot-eidx in locators
    - Never use container locators in recorded code
    - Prefer one-argument locators or self-contained XPath/CSS locators
    - If the component is decorative, duplicated beyond recovery, or not drillable, call drill_skip
    ${component ? `- Current component: ${component.name} (${component.role})` : ''}
    </rules>

    ${drillLocatorRule}

    ${customPrompt || ''}
    `;
  }

  async drill(opts: DrillOptions = {}): Promise<Plan> {
    const { knowledgePath, maxComponents = 30, interactive = isInteractive() } = opts;
    const currentState = this.explorer.getStateManager().getCurrentState();
    if (!currentState) throw new Error('No page state available');

    const sessionName = `driller_${Date.now().toString(36)}`;
    this.allResults = [];

    return Observability.run(`driller: ${currentState.url}`, { tags: ['driller'], sessionId: sessionName }, async () => {
      tag('info').log(`Driller starting on ${currentState.url}`);
      await this.hooksRunner.runBeforeHook('driller', currentState.url);

      const originalState = await this.captureAnnotatedState();
      const components = await this.collectComponents(originalState, maxComponents);

      this.currentPlan = new Plan(`Drill: ${originalState.url}`);
      this.currentPlan.url = originalState.url;

      for (const component of components) {
        const test = new Test(`Drill: ${component.name} [${component.id}]`, 'normal', [`Learn a reusable interaction for ${component.name}`], originalState.url) as ComponentTest;
        test.component = component;
        test.interactions = [];
        this.currentPlan.addTest(test);
      }

      if (components.length === 0) {
        tag('warning').log('No drillable components found on page');
        await this.hooksRunner.runAfterHook('driller', originalState.url);
        return this.currentPlan;
      }

      for (const test of this.currentPlan.tests) {
        const componentTest = test as ComponentTest;
        if (!componentTest.component) continue;
        await this.restoreOriginalState(originalState, `Prepare component ${componentTest.component.name}`);
        await this.captureAnnotatedState();
        await this.drillComponent(componentTest, originalState, interactive);
      }

      await this.saveToExperience(originalState, this.allResults);
      if (knowledgePath) await this.saveToKnowledge(knowledgePath, originalState, this.allResults);

      await this.hooksRunner.runAfterHook('driller', originalState.url);
      this.logSummary();
      return this.currentPlan;
    });
  }

  private async captureAnnotatedState(): Promise<ActionResult> {
    setActivity(`${this.emoji} Capturing annotated page state...`, 'action');
    const action = this.explorer.createAction();
    try {
      const annotated = await Promise.race([
        this.explorer.annotateElements(),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('annotateElements timeout')), 15000);
        }),
      ]);
      return action.capturePageState({ ariaSnapshot: annotated.ariaSnapshot });
    } catch (error) {
      tag('warning').log(`Annotated capture failed, falling back to plain page state: ${error instanceof Error ? error.message : error}`);
      return action.capturePageState();
    } finally {
      setActivity(`${this.emoji} Annotated page state captured`, 'action');
    }
  }

  private async collectComponents(state: ActionResult, maxComponents: number): Promise<ComponentInfo[]> {
    setActivity(`${this.emoji} Collecting components...`, 'action');
    const page = this.explorer.playwrightHelper.page;
    const eidxList = await this.explorer.getEidxInContainer(null);
    const webElements = await WebElement.fromEidxList(page, eidxList);
    const ariaNodes = collectInteractiveNodes(state.ariaSnapshot);
    const scored = webElements
      .filter((element) => isDrillableElement(element))
      .map((element) => ({ element, score: scoreComponentPriority(element) }))
      .sort((left, right) => right.score - left.score);
    const primary = scored.filter((entry) => entry.score >= 0).map((entry) => entry.element);
    const fallback = scored.filter((entry) => entry.score < 0).map((entry) => entry.element);
    const primaryButtonLike = primary.filter((element) => isButtonLikeElement(element));
    const primaryOther = primary.filter((element) => !isButtonLikeElement(element));
    const fallbackButtonLike = fallback.filter((element) => isButtonLikeElement(element));
    const fallbackOther = fallback.filter((element) => !isButtonLikeElement(element));
    const prioritized = primaryButtonLike.length >= maxComponents
      ? primaryButtonLike
      : [...primaryButtonLike, ...fallbackButtonLike, ...primaryOther, ...fallbackOther];
    const components: ComponentInfo[] = [];
    const seen = new Set<string>();

    for (const element of prioritized) {
      if (components.length >= maxComponents) break;
      const eidx = element.eidx;
      if (!eidx || !element.clickXPath) continue;
      const component = this.toComponentInfo(element, ariaNodes);
      if (seen.has(component.id)) continue;
      seen.add(component.id);
      components.push(component);
    }

    tag('info').log(`Prepared ${components.length} components for drilling (main content first)`);
    return components;
  }

  private toComponentInfo(element: WebElement, ariaNodes: Array<Record<string, unknown>>): ComponentInfo {
    const role = inferRole(element);
    const text = element.text || element.attrs['aria-label'] || element.attrs.placeholder || element.attrs.name || '';
    const fallbackName = element.attrs.id || element.attrs.class || element.tag;
    const context = truncate(element.contextLabel, 80);
    const variant = formatVariant(element.variantHints);
    const name = formatComponentName(role, text || fallbackName, context, variant);
    const normalizedText = normalized(text);
    const ariaMatches = ariaNodes
      .filter((node) => {
        const nodeRole = typeof node.role === 'string' ? node.role : '';
        if (nodeRole !== role) return false;
        const nodeName = typeof node.name === 'string' ? node.name : '';
        const normalizedName = normalized(nodeName);
        if (normalizedName === '' || normalizedText === '') return false;
        return normalizedName === normalizedText || normalizedName.includes(normalizedText) || normalizedText.includes(normalizedName);
      })
      .slice(0, 3)
      .map((node) => formatAriaNode(node));

    const component: ComponentInfo = {
      id: buildComponentId(element, role, text),
      name,
      role,
      locator: element.clickXPath,
      preferredCode: '',
      eidx: element.eidx!,
      description: element.description,
      html: element.outerHTML,
      text,
      tag: element.tag,
      classes: element.filteredClasses,
      context,
      variant,
      placeholder: element.attrs.placeholder || '',
      disabled: element.variantHints.includes('disabled') || element.filteredClasses.includes('cursor-not-allowed') || element.attrs.disabled !== undefined || element.attrs['aria-disabled'] === 'true',
      ariaMatches,
    };
    component.preferredCode = buildCanonicalClickCode(component);
    return component;
  }

  private async drillComponent(test: ComponentTest, originalState: ActionResult, interactive: boolean): Promise<void> {
    const component = test.component;
    if (!component) return;

    if (component.disabled) {
      const description = 'Component is disabled and has no drillable interactive behavior.';
      test.start();
      test.interactions ||= [];
      test.interactions.push({ componentId: component.id, component: component.name, action: 'skip', result: 'unknown', description });
      test.addNote(`Skipped: ${description}`, TestResult.SKIPPED);
      test.finish(TestResult.SKIPPED);
      this.allResults.push({ componentId: component.id, component: component.name, action: 'skip', result: 'unknown', description });
      tag('warning').log(`Skipped ${component.name}: disabled component`);
      return;
    }

    test.start();
    this.verifiedAction = null;
    this.pendingNestedContext = null;
    const conversation = this.provider.startConversation(this.getSystemMessage(component), 'driller');
    this.currentConversation = conversation;
    conversation.addUserText(await this.buildComponentPrompt(originalState, component));

    let finished = false;
    const actionTools = this.createVerifiedActionTools(createCodeceptJSTools(this.explorer, test), component);
    const tools = { ...actionTools, ...this.createDrillFlowTools(originalState, test, interactive) };

    await loop(async ({ stop, iteration }) => {
      debugLog(`Drilling component ${component.name}, iteration ${iteration}`);
      setActivity(`${this.emoji} Drilling ${component.name}...`, 'action');

      if (iteration > 1) {
        const currentState = ActionResult.fromState(this.explorer.getStateManager().getCurrentState() || originalState);
        conversation.addUserText(await this.buildContextUpdate(currentState, component));
        if (this.pendingNestedContext) {
          conversation.addUserText(this.pendingNestedContext);
          this.pendingNestedContext = null;
        }
      }

      const result = await this.provider.invokeConversation(conversation, tools, {
        maxToolRoundtrips: 5,
        toolChoice: 'required',
        agentName: 'driller',
      });

      if (!result) throw new Error('Failed to get response from provider');

      const toolExecutions = result.toolExecutions || [];
      this.trackToolExecutions(toolExecutions);
      const failedActionCount = toolExecutions.filter((execution: any) => this.ACTION_TOOLS.includes(execution.toolName) && !execution.wasSuccessful).length;
      if (failedActionCount >= 4) stop();

      const hasDone = toolExecutions.some((execution: any) => execution.toolName === 'drill_done' && execution.wasSuccessful);
      const hasSkip = toolExecutions.some((execution: any) => execution.toolName === 'drill_skip' && execution.wasSuccessful);
      if (hasDone || hasSkip) {
        finished = true;
        stop();
      }

      if (iteration >= this.MAX_COMPONENT_ITERATIONS) stop();
    }, {
      maxAttempts: this.MAX_COMPONENT_ITERATIONS,
      interruptPrompt: `Drill interrupted while testing "${component.name}". Enter instruction (or "stop" to end):`,
      observability: { agent: 'driller', sessionId: `${test.id}_${component.eidx}` },
      catch: async ({ error, stop }) => {
        tag('error').log(`Drill error for ${component.name}: ${error}`);
        stop();
      },
    });

    if (finished || test.hasFinished) return;
    if ((test.interactions || []).some((interaction) => interaction.result === 'success')) {
      test.addNote('Recorded reusable interactions before loop stopped', TestResult.PASSED);
      test.finish(TestResult.PASSED);
      return;
    }

    test.addNote('No reusable interaction recorded', TestResult.FAILED);
    test.finish(TestResult.FAILED);
    this.allResults.push({ componentId: component.id, component: component.name, action: 'drill', result: 'failed', description: 'No reusable interaction recorded' });
  }

  private async buildComponentPrompt(originalState: ActionResult, component: ComponentInfo): Promise<string> {
    const html = await this.getComponentScopeHtml(component, originalState);
    const knowledge = this.getKnowledge(originalState);
    const experience = this.getExperience(originalState);
    const ariaMatches = component.ariaMatches.length > 0 ? component.ariaMatches.map((line) => `- ${line}`).join('\n') : '- no direct ARIA match';

    return dedent`
      <task>
      Drill exactly one component and learn a reusable interaction for it.
      </task>

      <page>
      URL: ${originalState.url}
      Title: ${originalState.title || 'Unknown'}
      </page>

      <component>
      ID: ${component.id}
      Name: ${component.name}
      Role: ${component.role}
      Preferred locator: ${component.locator}
      Preferred click code: ${component.preferredCode || '-'}
      eidx: ${component.eidx}
      DOM summary: ${component.description}
      Text: ${component.text || '-'}
      Context: ${component.context || '-'}
      Variant: ${component.variant || '-'}
      Matching ARIA candidates:
      ${ariaMatches}
      </component>

      <component_html>
      ${component.html}
      </component_html>

      <page_html>
      ${html}
      </page_html>

      <page_aria>
      ${originalState.getInteractiveARIA()}
      </page_aria>

      ${knowledge}
      ${experience}

      <instructions>
      1. Work only with this component
      2. Use Preferred click code first unless it clearly fails, then try other self-contained locators from page HTML
      3. Never use container locators in code
      4. Never use data-explorbot-eidx in code
      5. If the page changes, use drill_restore before continuing
      6. Call drill_record for each reusable interaction you discover
      7. When you are done exploring the component, call drill_done
      8. If the component is not drillable, call drill_skip
      9. If similar components exist, use Context and Variant to distinguish this exact variant instead of skipping immediately
      10. Do not switch to a sibling with the same text but different variant or size. Stay anchored to the current component's Preferred locator, Context, and Variant.
      </instructions>
    `;
  }

  private async buildContextUpdate(currentState: ActionResult, component: ComponentInfo): Promise<string> {
    return dedent`
      <context_update>
      Current URL: ${currentState.url}
      Continue drilling component: ${component.name}
      Context: ${component.context || '-'}
      Variant: ${component.variant || '-'}
      If the component moved or disappeared, reassess using the current ARIA tree.
      </context_update>

      <page_aria>
      ${currentState.getInteractiveARIA()}
      </page_aria>
    `;
  }

  private createDrillFlowTools(originalState: ActionResult, test: ComponentTest, interactive: boolean) {
    return {
      drill_record: tool({
        description: 'Record a reusable interaction for the current component. Use only when the code is reusable and does not depend on a container locator.',
        inputSchema: z.object({
          action: z.string().describe('Action performed, for example click, fill, select, open, toggle'),
          result: z.string().describe('What happened after the interaction'),
          code: z.string().describe('Reusable CodeceptJS code that worked'),
        }),
        execute: async ({ action, result, code }) => {
          const component = test.component;
          if (!component) return { success: false, message: 'No active component' };
          if (!this.hasVerifiedAction(component.id)) {
            return { success: false, message: 'drill_record requires a real successful click, form, or pressKey for this component in the current drill run.' };
          }

          const exactCode = this.verifiedAction?.code?.trim();
          const canonicalCode = this.verifiedAction?.canonicalCode?.trim();
          const recordedCode = code.trim();
          if (exactCode && canonicalCode && recordedCode !== exactCode && recordedCode !== canonicalCode && !recordedCode.includes(exactCode) && !recordedCode.includes(canonicalCode)) {
            return { success: false, message: `drill_record must save the verified code for this component: ${canonicalCode}` };
          }
          if (exactCode && !canonicalCode && recordedCode !== exactCode && !recordedCode.includes(exactCode)) {
            return { success: false, message: `drill_record must save the exact code that just worked for this component: ${this.verifiedAction?.code || exactCode}` };
          }
          if (hasContainerLocator(code)) {
            return { success: false, message: 'Container locators are not allowed in driller records. Rewrite the code with a self-contained locator.' };
          }

          const normalizedResult = normalizeInteractionResult(component, action, result);
          const interaction: InteractionResult = {
            componentId: component.id,
            component: component.name,
            action,
            result: 'success',
            description: normalizedResult,
            code: recordedCode === exactCode || recordedCode === canonicalCode ? canonicalCode || code : code,
          };

          test.interactions ||= [];
          test.interactions.push(interaction);
          test.addNote(`${action}: ${normalizedResult}`, TestResult.PASSED);
          this.allResults.push(interaction);

          tag('success').log(`${component.name}: ${action} -> ${normalizedResult}`);
          return { success: true, recorded: `${component.name}: ${action} -> ${normalizedResult}` };
        },
      }),

      drill_done: tool({
        description: 'Finish drilling the current component after all useful interactions have been recorded.',
        inputSchema: z.object({
          summary: z.string().describe('What was learned about this component'),
        }),
        execute: async ({ summary }) => {
          const component = test.component;
          if (!component) return { success: false, message: 'No active component' };
          if (this.pendingNestedContext) {
            return { success: false, message: 'A nested overlay or popup opened after the last action. Drill useful interactions inside it before calling drill_done.' };
          }
          const successCount = (test.interactions || []).filter((interaction) => interaction.result === 'success').length;
          if (successCount === 0) {
            return { success: false, message: 'Record at least one reusable interaction before calling drill_done, or use drill_skip.' };
          }

          test.addNote(`Completed: ${summary}`, TestResult.PASSED);
          test.finish(TestResult.PASSED);
          return { success: true, summary, recorded: successCount };
        },
      }),

      drill_skip: tool({
        description: 'Skip the current component when it is decorative, duplicated beyond recovery, or not drillable.',
        inputSchema: z.object({
          reason: z.string().describe('Why the component is being skipped'),
        }),
        execute: async ({ reason }) => {
          const component = test.component;
          if (!component) return { success: false, message: 'No active component' };

          const interaction: InteractionResult = {
            componentId: component.id,
            component: component.name,
            action: 'skip',
            result: 'unknown',
            description: reason,
          };

          test.interactions ||= [];
          test.interactions.push(interaction);
          test.addNote(`Skipped: ${reason}`, TestResult.SKIPPED);
          test.finish(TestResult.SKIPPED);
          this.allResults.push(interaction);

          tag('warning').log(`Skipped ${component.name}: ${reason}`);
          return { success: true, skipped: component.name };
        },
      }),

      drill_restore: tool({
        description: 'Restore the original page state before continuing drilling.',
        inputSchema: z.object({
          reason: z.string().describe('Why restoration is needed'),
        }),
        execute: async ({ reason }) => {
          await this.restoreOriginalState(originalState, reason);
          await this.captureAnnotatedState();
          const currentState = this.explorer.getStateManager().getCurrentState();
          return { success: true, url: currentState?.url || originalState.url };
        },
      }),

      drill_ask: tool({
        description: 'Ask the user for help when stuck. Only available in interactive mode.',
        inputSchema: z.object({
          question: z.string().describe('What help is needed'),
        }),
        execute: async ({ question }) => {
          if (!interactive) return { success: false, message: 'Not in interactive mode' };
          const userInput = await pause(`${question}\n\nYour CodeceptJS command ("skip" to continue):`);
          if (!userInput || userInput.toLowerCase() === 'skip') return { success: false, skipped: true };
          return { success: true, userSuggestion: userInput, instruction: `Execute this suggestion if it helps: ${userInput}` };
        },
      }),
    };
  }

  private async restoreOriginalState(originalState: ActionResult, reason: string): Promise<void> {
    const currentState = this.explorer.getStateManager().getCurrentState();
    const targetUrl = originalState.fullUrl || originalState.url;
    const action = this.explorer.createAction();

    if (currentState?.url !== originalState.url) {
      await action.attempt(`I.amOnPage(${JSON.stringify(targetUrl)})`, `${reason} (restore URL)`, false);
      return;
    }

    await action.attempt('I.pressKey("Escape")', `${reason} (restore state)`, false);
  }

  private async saveToExperience(state: ActionResult, results: InteractionResult[]): Promise<void> {
    const experienceTracker = this.getExperienceTracker();
    const successfulInteractions = results.filter((result) => result.result === 'success' && result.code);

    for (const interaction of successfulInteractions) {
      await experienceTracker.saveSuccessfulResolution(state, `Drill ${interaction.action}: ${interaction.component}`, interaction.code!, interaction.description);
    }

    if (successfulInteractions.length > 0) {
      tag('success').log(`Saved ${successfulInteractions.length} drill interactions to experience`);
    }
  }

  private createVerifiedActionTools(baseTools: Record<string, any>, component: ComponentInfo): Record<string, any> {
    const wrappedTools = { ...baseTools };

    for (const toolName of this.ACTION_TOOLS) {
      const originalTool = wrappedTools[toolName];
      if (!originalTool) continue;
      wrappedTools[toolName] = tool({
        description: originalTool.description,
        inputSchema: originalTool.inputSchema,
        execute: async (input: any) => {
          const result = await originalTool.execute(input);
          if (result?.success) {
            this.verifiedAction = {
              componentId: component.id,
              toolName,
              code: typeof result.code === 'string' ? result.code : undefined,
              canonicalCode: typeof result.code === 'string' ? canonicalizeRecordedClick(component, result.code) : undefined,
            };
            this.pendingNestedContext = await this.detectNestedOverlayContext(component, result);
          }
          return result;
        },
      });
    }

    return wrappedTools;
  }

  private hasVerifiedAction(componentId: string): boolean {
    return this.verifiedAction?.componentId === componentId;
  }

  private async detectNestedOverlayContext(component: ComponentInfo, result: any): Promise<string | null> {
    if (!result?.pageDiff?.ariaChanges || result.pageDiff.urlChanged) return null;

    const overlayHtml = await this.getVisibleOverlayHtml();
    if (!overlayHtml) return null;

    const state = this.explorer.getStateManager().getCurrentState();
    if (!state) return null;
    const currentState = ActionResult.fromState(state);
    return dedent`
      <nested_overlay>
      The last action on ${component.name} opened a nested overlay, popup, dropdown, menu, or calendar.
      Drill useful interactions inside this nested UI before calling drill_done.
      Keep the recorded code reusable and include the parent-opening action when the nested element requires the overlay to be open.

      <overlay_html>
      ${overlayHtml}
      </overlay_html>

      <current_page_aria>
      ${currentState.getInteractiveARIA()}
      </current_page_aria>
      </nested_overlay>
    `;
  }

  private async getVisibleOverlayHtml(): Promise<string> {
    const page = this.explorer.playwrightHelper.page;
    return page.evaluate(() => {
      const selectors = [
        '.flatpickr-calendar.open',
        '.flatpickr-calendar:not([style*="display: none"]):not([style*="visibility: hidden"])',
        '.ember-attacher:not([style*="display: none"]):not([style*="visibility: hidden"])',
        '[role="dialog"]',
        '[role="listbox"]',
        '[role="menu"]',
        '[role="tooltip"]:not([style*="display: none"]):not([style*="visibility: hidden"])',
        '[x-placement]:not([style*="display: none"]):not([style*="visibility: hidden"])',
        '.dropdown-menu:not([style*="display: none"]):not([style*="visibility: hidden"])',
        '.popover:not([style*="display: none"]):not([style*="visibility: hidden"])',
      ];

      function isVisible(element: Element): boolean {
        const html = element as HTMLElement;
        const style = window.getComputedStyle(html);
        const rect = html.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return false;
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (Number.parseFloat(style.opacity || '1') < 0.1) return false;
        return true;
      }

      const overlays: string[] = [];
      const seen = new Set<Element>();
      for (const selector of selectors) {
        for (const element of Array.from(document.querySelectorAll(selector))) {
          if (seen.has(element)) continue;
          seen.add(element);
          if (!isVisible(element)) continue;
          const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
          const interactiveCount = element.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [role="link"], [role="option"], [role="menuitem"], [role="switch"], [role="checkbox"], [role="radio"], [tabindex]').length;
          if (interactiveCount === 0 && text.length === 0) continue;
          overlays.push((element as HTMLElement).outerHTML.slice(0, 6000));
        }
      }

      return overlays.slice(0, 3).join('\n\n--- overlay ---\n\n');
    });
  }

  private async getComponentScopeHtml(component: ComponentInfo, originalState: ActionResult): Promise<string> {
    const page = this.explorer.playwrightHelper.page;
    const scopedHtml = await page.evaluate((eidx: string) => {
      const element = document.querySelector(`[data-explorbot-eidx="${eidx}"]`);
      if (!element) return '';

      function countInteractive(node: Element): number {
        return node.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], [role="menuitem"]').length;
      }

      let current = element.parentElement;
      while (current) {
        const count = countInteractive(current);
        if (count > 0 && count <= 16) return current.outerHTML.slice(0, 8000);
        current = current.parentElement;
      }

      if (element instanceof HTMLElement) return element.outerHTML.slice(0, 8000);
      return '';
    }, component.eidx);

    if (scopedHtml) return scopedHtml;
    return await originalState.combinedHtml();
  }

  private async saveToKnowledge(knowledgePath: string, state: ActionResult, results: InteractionResult[]): Promise<void> {
    const knowledgeTracker = this.getKnowledgeTracker();
    const successfulInteractions = results.filter((result) => result.result === 'success');
    if (successfulInteractions.length === 0) {
      tag('warning').log('No successful interactions to save to knowledge');
      return;
    }

    const content = this.generateKnowledgeContent(state, successfulInteractions);
    const result = knowledgeTracker.addKnowledge(knowledgePath, content);
    tag('success').log(`Knowledge saved to: ${result.filePath}`);
  }

  private generateKnowledgeContent(state: ActionResult, interactions: InteractionResult[]): string {
    const lines: string[] = [];
    lines.push('# Component Interactions\n');
    lines.push(`Learned interactions from drilling ${state.url}\n`);

    const groupedByComponent = new Map<string, InteractionResult[]>();
    for (const interaction of interactions) {
      const existing = groupedByComponent.get(interaction.component) || [];
      existing.push(interaction);
      groupedByComponent.set(interaction.component, existing);
    }

    for (const [component, items] of groupedByComponent) {
      lines.push(`\n## ${component}\n`);
      for (const item of items) {
        lines.push(`- **${item.action}**: ${item.description}`);
        if (item.code) {
          lines.push('```js');
          lines.push(item.code);
          lines.push('```');
        }
      }
    }

    return lines.join('\n');
  }

  private logSummary(): void {
    if (!this.currentPlan) return;

    const total = this.currentPlan.tests.length;
    const passed = this.currentPlan.tests.filter((test) => test.isSuccessful).length;
    const skipped = this.currentPlan.tests.filter((test) => test.isSkipped).length;
    const failed = this.currentPlan.tests.filter((test) => test.hasFailed).length;

    tag('info').log('\nDrill Summary:');
    tag('info').log(`  Total components: ${total}`);
    tag('success').log(`  Successful: ${passed}`);
    if (skipped > 0) tag('warning').log(`  Skipped: ${skipped}`);
    if (failed > 0) tag('warning').log(`  Failed: ${failed}`);

    for (const test of this.currentPlan.tests) {
      const componentTest = test as ComponentTest;
      const status = test.isSuccessful ? 'PASS' : test.isSkipped ? 'SKIP' : 'FAIL';
      tag('step').log(`  ${status} ${componentTest.component?.name || test.scenario}`);
    }
  }

  getCurrentPlan(): Plan | undefined {
    return this.currentPlan;
  }

  getConversation(): Conversation | null {
    return this.currentConversation;
  }
}

function formatAriaNode(node: Record<string, unknown>): string {
  const role = typeof node.role === 'string' ? node.role : 'unknown';
  const name = typeof node.name === 'string' ? node.name : '';
  const value = typeof node.value === 'string' ? `: ${node.value}` : '';
  return [role, name ? `"${name}"` : '', value].filter(Boolean).join(' ').trim();
}

function inferRole(element: WebElement): string {
  if (element.tag === 'iframe' && element.variantHints.includes('code-editor')) return 'code-editor';
  if (element.role) return element.role.toLowerCase();
  const explicitRole = element.attrs.role;
  if (explicitRole) return explicitRole.toLowerCase();
  if (element.tag === 'a' && element.attrs.href) return 'link';
  if (element.tag === 'button') return 'button';
  if (element.tag === 'iframe') return 'iframe';
  if (element.tag === 'select') return 'combobox';
  if (element.tag === 'textarea') return 'textbox';
  if (element.tag === 'input') {
    const type = (element.attrs.type || 'text').toLowerCase();
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    return 'textbox';
  }
  return element.tag;
}

function normalized(value: string): string {
  return value.trim().toLowerCase();
}

function capitalize(value: string): string {
  if (!value) return value;
  return value[0].toUpperCase() + value.slice(1);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3)}...`;
}

function buildComponentId(element: WebElement, role: string, text: string): string {
  const parts = [role, normalized(text), normalized(element.contextLabel), element.variantHints.join('|'), element.clickXPath, String(element.eidx || '')];
  return parts.join('|').toLowerCase();
}

function canonicalizeRecordedClick(component: ComponentInfo, fallbackCode: string): string {
  const preferred = buildCanonicalClickCode(component);
  if (preferred) return preferred;
  return fallbackCode;
}

function buildCanonicalClickCode(component: ComponentInfo): string {
  if (component.tag === 'a') return '';
  if (component.tag === 'iframe' || component.role === 'code-editor') return buildEmbeddedFrameCode(component);

  const scopedCode = buildScopedFreestyleClickCode(component);
  if (scopedCode) return scopedCode;

  const variantHints = parseVariantHints(component.variant);
  const classSelector = buildClassSelector(component.tag, component.classes);
  if (!classSelector) return component.locator ? `I.click(${JSON.stringify(component.locator)})` : '';

  if (!component.text) {
    let selector = classSelector;
    if (variantHints.has('double-icon')) selector += ':has(svg):has(svg + svg)';
    else if (variantHints.has('has-icon') || variantHints.has('icon-only')) selector += ':has(svg)';
    return `I.click(${JSON.stringify(selector)})`;
  }

  let selector = `${classSelector}:has-text(${JSON.stringify(component.text)})`;
  if (variantHints.has('double-icon')) selector += ':has(svg):has(svg + svg)';
  else if (variantHints.has('trailing-icon')) selector += ':has(svg):not(:has(svg + svg))';
  else if (variantHints.has('leading-icon') || variantHints.has('has-icon')) selector += ':has(svg)';

  if (!variantHints.has('has-icon') && !variantHints.has('icon-only') && !variantHints.has('leading-icon') && !variantHints.has('trailing-icon') && !variantHints.has('double-icon')) {
    const textLiteral = component.text.replace(/"/g, '\\"');
    const classConditions = component.classes.slice(0, 5).map((cls) => `contains(@class,"${cls}")`);
    const xpathConditions = [`self::${component.tag}`];
    xpathConditions.push(...classConditions);
    xpathConditions.push(`normalize-space(.)="${textLiteral}"`);
    xpathConditions.push('not(.//svg)');
    return `I.click(${JSON.stringify(`//*[${xpathConditions.join(' and ')}]`)})`;
  }

  return `I.click(${JSON.stringify(selector)})`;
}

function buildScopedFreestyleClickCode(component: ComponentInfo): string {
  if (!component.context) return '';

  const scope = `//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage ") and .//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage-title ") and normalize-space(.)=${xpathLiteral(component.context)}]]`;
  if (component.role === 'tab') {
    const tabCondition = buildTabVariantXPathCondition(component);
    return `I.click(${JSON.stringify(`${scope}//li[@role="tab"${tabCondition}]`)})`;
  }

  if (component.role === 'switch') {
    const enabled = component.classes.includes('cursor-not-allowed') ? '' : ' and not(contains(@class,"cursor-not-allowed"))';
    return `I.click(${JSON.stringify(`${scope}//button[@role="switch"${enabled}]`)})`;
  }

  if (component.tag === 'input' || component.role === 'textbox' || component.role === 'searchbox') {
    const placeholder = component.placeholder;
    if (placeholder) return `I.click(${JSON.stringify(`${scope}//input[@placeholder=${xpathLiteral(placeholder)}]`)})`;
    if (component.classes.length > 0) {
      const classConditions = component.classes.slice(0, 4).map((cls) => `contains(@class,${xpathLiteral(cls)})`).join(' and ');
      return `I.click(${JSON.stringify(`${scope}//input[${classConditions}]`)})`;
    }
  }

  return '';
}

function buildEmbeddedFrameCode(component: ComponentInfo): string {
  const src = component.html.match(/\ssrc=["']([^"']+)["']/i)?.[1] || '';
  const sourceIndex = component.html.match(/\sdata-explorbot-frame-source-index=["'](\d+)["']/i)?.[1] || '';
  const srcCondition = src ? `contains(@src,${xpathLiteral(src)})` : '';
  let scope = '';
  if (component.context) {
    scope = `//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage ") and .//*[contains(concat(" ", normalize-space(@class), " "), " FreestyleUsage-title ") and normalize-space(.)=${xpathLiteral(component.context)}]]`;
  }

  let iframeLocator = '//iframe';
  if (scope && !sourceIndex) iframeLocator = `${scope}//iframe`;
  if (srcCondition) iframeLocator += `[${srcCondition}]`;
  if (sourceIndex) iframeLocator = `(${iframeLocator})[${sourceIndex}]`;

  let editorLocator = 'body';
  let text = 'test';
  if (component.variant.includes('code-editor')) {
    editorLocator = '.monaco-editor';
    text = 'const value = "test";';
  }

  return [
    `I.switchTo(${JSON.stringify(iframeLocator)})`,
    `I.click(${JSON.stringify(editorLocator)})`,
    `I.type(${JSON.stringify(text)})`,
    'I.switchTo()',
  ].join('\n');
}

function buildTabVariantXPathCondition(component: ComponentInfo): string {
  const html = component.html.toLowerCase();
  const hasAutorenew = html.includes('md-icon-autorenew');
  const hasPlay = html.includes('md-icon-play');
  const hasCopyButton = html.includes('third-btn') || html.includes('md-icon-content-copy');
  const hasCounter = html.includes('new-counter');
  const hasStatus = html.includes('run-status');
  const conditions: string[] = [];

  if (hasStatus) conditions.push('.//*[contains(@class,"run-status")]');
  else conditions.push('not(.//*[contains(@class,"run-status")])');

  if (hasCounter) conditions.push('.//*[contains(@class,"new-counter")]');
  else conditions.push('not(.//*[contains(@class,"new-counter")])');

  if (hasCopyButton) conditions.push('.//button[contains(@class,"third-btn")]');
  else conditions.push('not(.//button[contains(@class,"third-btn")])');

  if (hasAutorenew) conditions.push('.//*[local-name()="svg" and contains(@class,"md-icon-autorenew")]');
  else conditions.push('not(.//*[local-name()="svg" and contains(@class,"md-icon-autorenew")])');

  if (hasPlay) conditions.push('.//*[local-name()="svg" and contains(@class,"md-icon-play")]');
  else conditions.push('not(.//*[local-name()="svg" and contains(@class,"md-icon-play")])');

  return conditions.length > 0 ? ` and ${conditions.join(' and ')}` : '';
}

function formatVariant(variantHints: string[]): string {
  if (variantHints.length === 0) return '';
  return variantHints.slice(0, 4).join(', ');
}

function formatComponentName(role: string, label: string, context: string, variant: string): string {
  const safeLabel = label.trim();
  const quotedLabel = safeLabel ? `"${truncate(safeLabel, 48)}"` : role === 'button' ? '"Icon button"' : capitalize(role);
  const parts = [`${capitalize(role)} ${quotedLabel}`.trim()];
  if (context) parts.push(`[${context}]`);
  if (variant) parts.push(`(${variant})`);
  return parts.join(' ').trim();
}

function normalizeInteractionResult(component: ComponentInfo, action: string, result: string): string {
  const value = result.trim();
  if (!value) return fallbackInteractionResult(component, action);

  const normalizedValue = value.toLowerCase();
  const weakPhrases = [
    'button clicked',
    'clicked button',
    'button was clicked',
    'component clicked',
    'page remains same',
    'page stayed the same',
    'no visible change',
    'action performed',
    'clicked',
  ];

  if (weakPhrases.some((phrase) => normalizedValue === phrase || normalizedValue.includes(phrase))) {
    return fallbackInteractionResult(component, action);
  }

  if (!/[.!?]$/.test(value)) return `${value}.`;
  return value;
}

function fallbackInteractionResult(component: ComponentInfo, action: string): string {
  const role = component.role || component.tag;
  const label = component.text ? `"${truncate(component.text, 40)}"` : `the ${role}`;
  const variant = component.variant ? ` (${component.variant})` : '';
  if (action === 'click') return `Clicked ${label}${variant}.`;
  if (action === 'pressKey') return `Pressed key on ${label}${variant}.`;
  if (action === 'form') return `Submitted interaction for ${label}${variant}.`;
  return `${capitalize(action)} executed for ${label}${variant}.`;
}

function hasContainerLocator(code: string): boolean {
  for (const line of code.split('\n').map((entry) => entry.trim()).filter(Boolean)) {
    const argCount = countTopLevelArgs(line);
    if (line.startsWith('I.click(') && argCount >= 2) return true;
    if (line.startsWith('I.fillField(') && argCount >= 3) return true;
    if (line.startsWith('I.selectOption(') && argCount >= 3) return true;
    if (line.startsWith('I.attachFile(') && argCount >= 3) return true;
    if (line.startsWith('I.checkOption(') && argCount >= 2) return true;
    if (line.startsWith('I.uncheckOption(') && argCount >= 2) return true;
  }
  return false;
}

function countTopLevelArgs(line: string): number {
  const start = line.indexOf('(');
  const end = line.lastIndexOf(')');
  if (start === -1 || end === -1 || end <= start + 1) return 0;

  const body = line.slice(start + 1, end);
  let count = 1;
  let depth = 0;
  let quote = '';

  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    const escaped = body[i - 1] === '\\';

    if (quote) {
      if (char === quote && !escaped) quote = '';
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }

    if (char === '(' || char === '[' || char === '{') {
      depth++;
      continue;
    }

    if (char === ')' || char === ']' || char === '}') {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (char === ',' && depth === 0) count++;
  }

  return count;
}

function buildClassSelector(tag: string, classes: string[]): string {
  const safeClasses = classes.filter((cls) => /^[a-z0-9_-]+$/i.test(cls)).slice(0, 5);
  if (safeClasses.length === 0) return '';
  return `${tag}${safeClasses.map((cls) => `.${cls}`).join('')}`;
}

function parseVariantHints(variant: string): Set<string> {
  return new Set(variant.split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean));
}

function xpathLiteral(value: string): string {
  if (!value.includes('"')) return `"${value}"`;
  if (!value.includes("'")) return `'${value}'`;
  return `concat("${value.replace(/"/g, '", \'"\', "')}")`;
}

function scoreComponentPriority(element: WebElement): number {
  let score = 0;
  const hints = element.areaHints;
  const text = normalized(element.text);
  const attrs = Object.values(element.attrs).join(' ').toLowerCase();
  const role = (element.role || element.attrs.role || element.tag).toLowerCase();

  if (hints.includes('main')) score += 50;
  if (hints.includes('article')) score += 40;
  if (hints.includes('section')) score += 20;
  if (hints.some((hint) => hint.includes('content'))) score += 20;
  if (role === 'tab') score += 35;
  if (isSemanticFormControl(element)) score += 35;
  if (element.tag === 'iframe') score += 35;
  if (element.variantHints.includes('code-editor')) score += 60;
  if (element.tag === 'button') score += 20;
  if (element.tag === 'input' || element.tag === 'textarea' || element.tag === 'select') score += 18;
  if (element.tag === 'a') score -= 40;
  if (text.length > 0) score += Math.min(text.length, 20);
  if (hints.includes('nav') || hints.includes('menu') || hints.includes('header') || hints.includes('footer') || hints.includes('aside')) score -= 90;
  if (hints.some((hint) => hint.startsWith('role:navigation') || hint.startsWith('role:menu') || hint.startsWith('role:menubar') || hint.startsWith('role:tablist'))) score -= 90;
  if (attrs.includes('sidebar') || attrs.includes('sidemenu') || attrs.includes('topnav') || attrs.includes('navbar') || attrs.includes('breadcrumb')) score -= 40;
  if (text === 'home' || text === 'settings' || text === 'profile' || text === 'logout') score -= 10;
  if (attrs.includes('tooltip') || attrs.includes('attacher') || attrs.includes('popover') || attrs.includes('dropdown')) score -= 20;
  return score;
}

function isDrillableElement(element: WebElement): boolean {
  const attrs = Object.values(element.attrs).join(' ').toLowerCase();
  const text = normalized(element.text);
  if (attrs.includes('tooltip') || attrs.includes('attacher')) return false;
  if (isNestedCompositeControl(element)) return false;
  if (element.tag === 'iframe') return true;
  if (text === '') {
    if (!isInteractiveElement(element)) return false;
    if (isSemanticFormControl(element)) return true;
    if (!element.variantHints.includes('icon-only') && !element.variantHints.includes('has-icon')) return false;
  }
  return true;
}

function isNestedCompositeControl(element: WebElement): boolean {
  const role = (element.role || element.attrs.role || element.tag).toLowerCase();
  if (COMPOSITE_TARGET_ROLES.has(role)) return false;
  if (!isInteractiveElement(element)) return false;
  return element.areaHints.some((hint) => COMPOSITE_AREA_HINTS.has(hint));
}

function isSemanticFormControl(element: WebElement): boolean {
  const role = (element.role || element.attrs.role || element.tag).toLowerCase();
  if (element.tag === 'input' || element.tag === 'select' || element.tag === 'textarea') return true;
  return FORM_CONTROL_ROLES.has(role);
}

function isButtonLikeElement(element: WebElement): boolean {
  if (!isInteractiveElement(element)) return false;
  const role = (element.role || element.attrs.role || element.tag).toLowerCase();
  if (role === 'link' || element.tag === 'a') return false;
  return true;
}

function isInteractiveElement(element: WebElement): boolean {
  if (element.tag === 'button') return true;
  if (element.tag === 'a' && element.attrs.href) return true;
  if (element.tag === 'iframe') return true;
  if (element.tag === 'input' || element.tag === 'select' || element.tag === 'textarea') return true;
  const role = (element.role || element.attrs.role || element.tag).toLowerCase();
  if (INTERACTIVE_ROLES.has(role)) return true;
  if (element.attrs.contenteditable === 'true') return true;
  if (element.attrs.tabindex && Number(element.attrs.tabindex) >= 0) return true;
  if (element.attrs['aria-haspopup'] || element.attrs['aria-expanded'] || element.attrs['aria-controls']) return true;
  return false;
}

const INTERACTIVE_ROLES = new Set(['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'combobox', 'iframe', 'code-editor', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'slider', 'spinbutton', 'textbox', 'searchbox', 'treeitem']);
const FORM_CONTROL_ROLES = new Set(['checkbox', 'radio', 'switch', 'combobox', 'option', 'slider', 'spinbutton', 'textbox', 'searchbox']);
const COMPOSITE_TARGET_ROLES = new Set(['tab', 'option', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'treeitem']);
const COMPOSITE_AREA_HINTS = new Set(['role:tab', 'role:option', 'role:menuitem', 'role:menuitemcheckbox', 'role:menuitemradio', 'role:treeitem']);

const drillLocatorRule = locatorRule.replace(/<context_simplification>[\s\S]*?<\/context_simplification>/, '').trim();
