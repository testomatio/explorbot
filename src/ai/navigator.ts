import dedent from 'dedent';
import { ActionResult } from '../action-result.js';
import { ExperienceTracker } from '../experience-tracker.js';
import Explorer from '../explorer.ts';
import { KnowledgeTracker } from '../knowledge-tracker.js';
import { type WebPageState, normalizeUrl } from '../state-manager.js';
import { extractCodeBlocks } from '../utils/code-extractor.js';
import { HooksRunner } from '../utils/hooks-runner.ts';
import { createDebug, pluralize, tag } from '../utils/logger.js';
import { loop, pause } from '../utils/loop.js';
import type { Agent } from './agent.js';
import type { Conversation } from './conversation.js';
import { ExperienceCompactor } from './experience-compactor.js';
import type { Provider } from './provider.js';
import { Researcher } from './researcher.ts';
import { actionRule, locatorRule } from './rules.js';
import { RulesLoader } from '../utils/rules-loader.ts';
import { isInteractive } from './task-agent.js';

const debugLog = createDebug('explorbot:navigator');

class Navigator implements Agent {
  emoji = '🧭';
  private provider: Provider;
  private experienceCompactor: ExperienceCompactor;
  private knowledgeTracker: KnowledgeTracker;
  private experienceTracker: ExperienceTracker;
  private currentAction: any = null;
  private currentUrl: string | null = null;
  private hooksRunner: HooksRunner;

  private MAX_ATTEMPTS = Number.parseInt(process.env.MAX_ATTEMPTS || '5');

  private systemPrompt = dedent`
  <role>
    You are senior test automation engineer with master QA skills.
    You write test automation in CodeceptJS.
  </role>
  <task>
    You are given the web page and a message from user.
    You need to resolve the state of the page based on the message.
  </task>
  `;
  private freeSailSystemPrompt = dedent`
  <role>
    You help with exploratory web navigation.
  </role>
  <rules>
    Always propose a single next navigation target, preferring least-visited pages.
    Base the suggestion only on the provided research notes and HTML snapshot.
    The target MUST be a URL path starting with "/" (e.g., /requirements, /dashboard/settings).
    Only use URLs that appear in the HTML (href attributes) or in the visited URLs list. Never guess or invent URLs.
    Never return page names, link text, or headings as targets.
    Respond with exactly two lines:
    Next: <target>
    Reason: <short justification>
  </rules>
  `;
  private explorer: Explorer;

  constructor(explorer: Explorer, provider: Provider, experienceCompactor: ExperienceCompactor, experienceTracker?: ExperienceTracker) {
    this.provider = provider;
    this.explorer = explorer;
    this.experienceCompactor = experienceCompactor;
    this.knowledgeTracker = new KnowledgeTracker();
    this.experienceTracker = experienceTracker || new ExperienceTracker();
    this.hooksRunner = new HooksRunner(explorer, explorer.getConfig());
  }

  private isOnExpectedPage(expectedUrl: string, stateManager: any): boolean {
    const currentUrl = stateManager.getCurrentState()?.url || '';
    return normalizeUrl(currentUrl) === normalizeUrl(expectedUrl);
  }

  async visit(url: string): Promise<void> {
    try {
      const action = this.explorer.createAction();

      await action.execute(`I.amOnPage('${url}')`);

      const currentUrl = action.stateManager.getCurrentState()?.url || '';
      if (currentUrl === 'about:blank' || currentUrl === '') {
        throw new Error(`Navigation to "${url}" opened an empty page. The target must be a valid URL path starting with "/".`);
      }

      await this.hooksRunner.runBeforeHook('navigator', url);

      if (!this.isOnExpectedPage(url, action.stateManager)) {
        const actualPath = action.stateManager.getCurrentState()?.url || '';
        const actionResult = action.actionResult || ActionResult.fromState(action.stateManager.getCurrentState()!);
        const originalMessage = `Navigate to: ${url}. Current page: ${actualPath}`;

        this.currentAction = action;
        this.currentUrl = url;
        const resolved = await this.resolveState(originalMessage, actionResult);
        if (!resolved) {
          throw new Error(`Navigation to ${url} failed: redirected to ${actualPath} and could not resolve`);
        }
      } else if (action.lastError) {
        const actionResult = action.actionResult || ActionResult.fromState(action.stateManager.getCurrentState()!);
        const originalMessage = `
          I tried to navigate to: ${url}
          And I expected to see the URL in the browser
          But I got error: ${action.lastError?.message || 'Navigation failed'}.
        `.trim();

        this.currentAction = action;
        this.currentUrl = url;
        const resolved = await this.resolveState(originalMessage, actionResult);
        if (!resolved) {
          throw new Error(`Navigation to ${url} failed: ${action.lastError?.message}`);
        }
      }
      await action.caputrePageWithScreenshot();
      await this.hooksRunner.runAfterHook('navigator', url);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('ERR_CONNECTION_REFUSED')) {
        const urlMatch = errorMessage.match(/at (https?:\/\/[^\s/]+)/);
        const baseUrl = urlMatch ? urlMatch[1] : url;
        throw new Error(`Connection refused: ${baseUrl} is not accessible. Is the server running?`);
      }
      throw error;
    }
  }

  async resolveState(message: string, actionResult: ActionResult): Promise<boolean> {
    tag('info').log('AI Navigator resolving state at', actionResult.url);
    debugLog('Resolution message:', message);

    let knowledge = '';
    let experience = '';

    const relevantKnowledge = this.knowledgeTracker.getRelevantKnowledge(actionResult);
    if (relevantKnowledge.length > 0) {
      const knowledgeContent = relevantKnowledge.map((k) => k.content).join('\n\n');
      knowledge = `
      <hint>
      Here is relevant knowledge for this page:
      ${knowledgeContent}
      </hint>`;
    }

    const relevantExperience = this.experienceTracker.getRelevantExperience(actionResult).map((experience) => experience.content);

    if (relevantExperience.length > 0) {
      const experienceContent = relevantExperience.join('\n\n---\n\n');
      experience = await this.experienceCompactor.compactExperience(experienceContent);
      tag('substep').log(`Found ${relevantExperience.length} experience ${pluralize(relevantExperience.length, 'file')} for: ${actionResult.url}`);

      experience = dedent`
      <experience>
      Here is the experience of interacting with the page.
      Learn from it AND DO NOT REPEAT THE SAME MISTAKES.
      If there was found successful solution to an issue, propose it as a first solution.
      If there are no successful solutions, analyze failed intentions and actions to avoid them.
      Do not try again same failed solutions

      Focus on successful solutions and avoid actions and locators that caused errors in past.

      ${experienceContent}

      </experience>`;
    }

    const prompt = dedent`
      <message>
        ${message}
      </message>

      <task>
        Identify the actual request of the user.
        Identify what is expected by user.
        Identify what might have caused the error.
        Propose different solutions to achieve the result.
        Solution should be valid CodeceptJS code.
        Use only data from the <page> context to plan the solution.
        Try various ways to achieve the result
      </task>


      <page>
        ${actionResult.toAiContext()}

        <page_html>
        ${await actionResult.simplifiedHtml()}
        </page_html>
      </page>


      ${knowledge}

      ${actionRule}

      ${experience}

      ${locatorRule}

      ${RulesLoader.loadRules('navigator', ['multiple-locator', 'output'], actionResult.url || '').replace('{{maxAttempts}}', String(this.MAX_ATTEMPTS))}
    `;

    const conversation = this.provider.startConversation(this.systemPrompt, 'navigator');
    conversation.addUserText(prompt);

    let codeBlocks: string[] = [];
    let htmlContextAdded = false;
    let codeBlockIndex = 0;
    let totalAttempts = 0;

    let resolved = false;
    await loop(
      async ({ stop }) => {
        if (codeBlocks.length === 0) {
          const result = await this.provider.invokeConversation(conversation);
          if (!result) return;
          const aiResponse = result?.response?.text;
          debugLog('AI:', aiResponse?.split('\n')[0]);
          debugLog('Received AI response:', aiResponse.length, 'characters');
          codeBlocks = extractCodeBlocks(aiResponse ?? '');
          codeBlockIndex = 0;
        }

        if (codeBlocks.length === 0) {
          stop();
          return;
        }

        const codeBlock = codeBlocks[codeBlockIndex];
        if (!codeBlock) {
          if (!htmlContextAdded) {
            htmlContextAdded = true;
            tag('substep').log('Adding HTML context for better resolution...');
            conversation.addUserText(dedent`
              Previous solutions did not work. Here is the full HTML context:

              <page_html>
              ${await actionResult.simplifiedHtml()}
              </page_html>

              Please suggest new solutions based on this additional context.
            `);
            codeBlocks = [];
            return;
          }
          stop();
          return;
        }
        codeBlockIndex++;
        totalAttempts++;

        debugLog(`Attempting resolution: ${codeBlock}`);
        resolved = await this.currentAction.attempt(codeBlock, message);

        if (this.currentUrl) {
          await this.currentAction.getActor().wait(2);
          const freshState = await this.currentAction.capturePageState();

          if (normalizeUrl(freshState.url || '') === normalizeUrl(this.currentUrl)) {
            resolved = true;
          } else if (resolved) {
            tag('warning').log(`URL verification failed: expected ${this.currentUrl}, got ${freshState.url}`);
            resolved = false;
          }
        }

        if (resolved) {
          tag('success').log('Navigation resolved successfully');
          stop();
          return;
        }
      },
      {
        maxAttempts: this.MAX_ATTEMPTS * 2,
        observability: {
          agent: 'navigator',
        },
        catch: async (error) => {
          debugLog(error);
          resolved = false;
        },
      }
    );

    if (!resolved && this.currentUrl) {
      await this.currentAction.getActor().wait(1);
      if (this.isOnExpectedPage(this.currentUrl, this.currentAction.stateManager)) {
        resolved = true;
        tag('success').log('Navigation resolved after delayed redirect');
      }
    }

    if (!resolved && totalAttempts > 0) {
      tag('error').log(`Navigation failed after ${totalAttempts} attempts`);
    }

    if (!resolved && isInteractive()) {
      const userInput = await pause(`Navigator failed to resolve. Current: ${this.currentAction.stateManager.getCurrentState()?.url}\n` + `Target: ${this.currentUrl}\nEnter CodeceptJS commands (or press Enter to skip):`);

      if (userInput?.trim()) {
        resolved = await this.currentAction.attempt(userInput, message);
        if (resolved && this.currentUrl) {
          await this.currentAction.getActor().wait(1);
          if (!this.isOnExpectedPage(this.currentUrl, this.currentAction.stateManager)) {
            resolved = false;
          }
        }
      }
    }

    return resolved;
  }

  async freeSail(opts?: { strategy?: 'deep' | 'shallow'; scope?: string; visitedUrls?: Set<string> }, actionResult?: ActionResult): Promise<{ target: string; reason: string } | null> {
    const stateManager = this.explorer.getStateManager();
    const state = stateManager.getCurrentState();
    if (!state) {
      return null;
    }

    const currentActionResult = actionResult || ActionResult.fromState(state);
    const research = Researcher.getCachedResearch(state) || '';
    const combinedHtml = await currentActionResult.combinedHtml();

    const history = stateManager.getStateHistory();
    const visitCounts = new Map<string, number>();

    const countVisit = (value?: string | null) => {
      if (!value) return;
      const normalized = normalizeUrl(value);
      if (normalized) visitCounts.set(normalized, (visitCounts.get(normalized) || 0) + 1);
    };

    for (const transition of history) {
      countVisit(transition.toState.url);
    }
    countVisit(state.url);

    if (opts?.visitedUrls) {
      for (const url of opts.visitedUrls) {
        const normalized = normalizeUrl(url);
        if (normalized && !visitCounts.has(normalized)) {
          visitCounts.set(normalized, 1);
        }
      }
    }

    const sortedVisits = [...visitCounts.entries()].sort((a, b) => a[1] - b[1]);
    const visitedBlock = sortedVisits.length > 0 ? sortedVisits.map(([url, count]) => `${url} (${count} ${count === 1 ? 'visit' : 'visits'})`).join('\n') : 'none';

    let strategyInstruction = '';
    if (opts?.strategy === 'deep') {
      strategyInstruction = 'Prefer nearby pages with low visit counts. Explore depth-first: prioritize newly discovered pages close to current URL.';
    } else if (opts?.strategy === 'shallow') {
      strategyInstruction = 'Pick the globally least-visited page. Spread exploration breadth-first across many different pages.';
    }

    let scopeInstruction = '';
    if (opts?.scope) {
      scopeInstruction = `IMPORTANT: Only suggest URLs that start with "${opts.scope}". Do not suggest URLs outside this scope.`;
    }

    const prompt = dedent`
      <research>
      ${research || 'No cached research available'}
      </research>

      <page_html>
      ${combinedHtml}
      </page_html>

      <context>
      Current URL: ${currentActionResult.url || 'unknown'}
      Visited URLs (sorted by visit count):
      ${visitedBlock}
      </context>

      <task>
      Suggest the next navigation target, preferring least-visited pages.
      ${strategyInstruction}
      ${scopeInstruction}
      </task>
    `;

    const conversation = this.provider.startConversation(this.freeSailSystemPrompt, 'navigator');
    conversation.addUserText(prompt);

    const minVisits = sortedVisits.length > 0 ? sortedVisits[0][1] : 0;
    let suggestion: { target: string; reason: string } | null = null;

    await loop(
      async ({ stop }) => {
        const result = await this.provider.invokeConversation(conversation);
        const text = result?.response?.text?.trim();
        if (!text) {
          stop();
          return;
        }

        const nextMatch = text.match(/Next:\s*(.+)/i);
        const reasonMatch = text.match(/Reason:\s*(.+)/i);
        const target = nextMatch?.[1]?.trim();
        if (!target) {
          stop();
          return;
        }

        const normalizedTarget = normalizeUrl(target);

        if (opts?.scope && !target.startsWith(opts.scope)) {
          conversation.addUserText(`"${target}" is outside scope "${opts.scope}". Suggest a URL within scope.`);
          return;
        }

        if (!target.startsWith('/') && !target.startsWith('http')) {
          conversation.addUserText(`"${target}" is not a valid URL path. Suggest a URL path starting with "/".`);
          return;
        }

        const targetVisits = visitCounts.get(normalizedTarget) || 0;
        if (targetVisits >= 5 && minVisits < 5) {
          conversation.addUserText(`"${target}" has been visited ${targetVisits} times. Choose a less-visited page from this list:\n${visitedBlock}`);
          return;
        }

        suggestion = {
          target,
          reason: `${reasonMatch?.[1]?.trim() || ''} (visited ${targetVisits}x)`,
        };
        stop();
      },
      {
        maxAttempts: 3,
        observability: {
          agent: 'navigator',
        },
      }
    );

    return suggestion;
  }

  async verifyState(message: string, actionResult: ActionResult): Promise<{ verified: boolean; successfulCodes: string[]; totalAttempted: number }> {
    tag('info').log('AI Navigator verifying state at', actionResult.url);
    debugLog('Verification message:', message);

    let knowledge = '';
    let experience = '';

    const relevantKnowledge = this.knowledgeTracker.getRelevantKnowledge(actionResult);
    if (relevantKnowledge.length > 0) {
      const knowledgeContent = relevantKnowledge.map((k) => k.content).join('\n\n');
      knowledge = `
      <hint>
      Here is relevant knowledge for this page:
      ${knowledgeContent}
      </hint>`;
    }

    const relevantExperience = this.experienceTracker.getRelevantExperience(actionResult).map((exp) => exp.content);

    if (relevantExperience.length > 0) {
      const experienceContent = relevantExperience.join('\n\n---\n\n');
      experience = await this.experienceCompactor.compactExperience(experienceContent);
      tag('substep').log(`Found ${relevantExperience.length} experience ${pluralize(relevantExperience.length, 'file')} for: ${actionResult.url}`);

      experience = dedent`
      <experience>
      Here is the experience of interacting with the page.
      Learn from it AND DO NOT REPEAT THE SAME MISTAKES.
      If there was found successful solution to an issue, propose it as a first solution.

      ${experienceContent}

      </experience>`;
    }

    const prompt = dedent`
      <message>
        ${message}
      </message>

      <task>
        Identify what assertion the user wants to verify on the page.
        Propose different CodeceptJS assertion code blocks to verify the expected state.
        Use only data from the <page> context to plan the verification.
        Try various locators and approaches to verify the assertion.

        IMPORTANT: Each code block must verify the SPECIFIC claim in the message, not just a generic aspect of it.
        Bad: I.seeElement({"role":"button","aria-pressed":"true"}) — matches ANY button, not the specific one
        Good: I.see("My Item", ".starred-list") — checks the specific item mentioned in the message
        If the message mentions a specific item, name, or value, EVERY assertion must include that specific text or identifier.
        Do not generate assertions that would pass even if the specific claim is false.
      </task>

      <page>
        ${actionResult.toAiContext()}

        <page_html>
        ${await actionResult.simplifiedHtml()}
        </page_html>
      </page>

      ${knowledge}

      ${RulesLoader.loadRules('navigator', ['verification-actions'], actionResult.url || '')}

      ${locatorRule}

      ${experience}
    `;

    debugLog('Sending verification prompt to AI provider');
    tag('debug').log('Prompt:', prompt);

    const conversation = this.provider.startConversation(this.systemPrompt, 'navigator');
    conversation.addUserText(prompt);

    let codeBlocks: string[] = [];
    const successfulCodes: string[] = [];

    const action = this.explorer.createAction();

    await loop(
      async ({ stop, iteration }) => {
        if (codeBlocks.length === 0) {
          const result = await this.provider.invokeConversation(conversation);
          if (!result) return;
          const aiResponse = result?.response?.text;
          debugLog('Received AI response:', aiResponse.length, 'characters');
          tag('step').log('Verifying assertion...');
          codeBlocks = extractCodeBlocks(aiResponse ?? '');
        }

        if (codeBlocks.length === 0) {
          return;
        }

        const codeBlock = codeBlocks[iteration - 1];
        if (!codeBlock) {
          stop();
          return;
        }

        const verified = await action.attempt(codeBlock, message, false);

        if (verified) {
          tag('success').log('Verification passed');
          successfulCodes.push(codeBlock);
        }
      },
      {
        maxAttempts: this.MAX_ATTEMPTS,
        observability: {
          agent: 'navigator',
        },
        catch: async (error) => {
          debugLog(error);
        },
      }
    );

    const totalAttempted = Math.min(codeBlocks.length, this.MAX_ATTEMPTS);
    const verified = totalAttempted <= 1 ? successfulCodes.length > 0 : successfulCodes.length > totalAttempted / 2;

    actionResult.addVerification(message, verified);
    this.explorer.getStateManager().updateState(actionResult);

    return { verified, successfulCodes, totalAttempted };
  }
}

export { Navigator };
