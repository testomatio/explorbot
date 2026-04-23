import dedent from 'dedent';
import { ActionResult } from '../action-result.js';
import type Action from '../action.ts';
import { ExperienceTracker, renderExperienceToc } from '../experience-tracker.js';
import Explorer from '../explorer.ts';
import { KnowledgeTracker } from '../knowledge-tracker.js';
import { type WebPageState, normalizeUrl } from '../state-manager.js';
import { extractCodeBlocks } from '../utils/code-extractor.js';
import { HooksRunner } from '../utils/hooks-runner.ts';
import { createDebug, pluralize, tag } from '../utils/logger.js';
import { loop, pause } from '../utils/loop.js';
import { RulesLoader } from '../utils/rules-loader.ts';
import { extractStatePath } from '../utils/url-matcher.js';
import type { Agent } from './agent.js';
import type { Conversation } from './conversation.js';
import { ExperienceCompactor } from './experience-compactor.js';
import type { Provider } from './provider.js';
import { Researcher } from './researcher.ts';
import { actionRule, locatorRule, unexpectedPopupRule } from './rules.js';
import { isInteractive } from './task-agent.js';
import { createAgentTools } from './tools.ts';

const debugLog = createDebug('explorbot:navigator');

class Navigator implements Agent {
  emoji = '🧭';
  private provider: Provider;
  private experienceCompactor: ExperienceCompactor;
  private knowledgeTracker: KnowledgeTracker;
  private experienceTracker: ExperienceTracker;
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

  ${locatorRule}

  <constraints>
    NEVER navigate away from the base URL domain. Stay on the same origin at all times.
    NEVER attempt to rewrite, replace, mock, or spoof the URL via JavaScript, history API, location assignment, or any client-side trick.
    NEVER use executeScript, executeAsyncScript, or any JS evaluation to change the URL, bypass redirects, or fake the page state.
    If the target URL redirects to an authentication/login page, DO NOT try to force the original URL. Instead:
      1. Look for credentials in the provided knowledge/hint context and perform a real login through the form.
      2. If no credentials are available, ask the user for credentials or ask the user to log in manually.
    A redirect to /login, /sign_in, /auth, or similar is a signal that authentication is required — treat it as such, never as an obstacle to bypass.
  </constraints>
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

        const resolved = await this.resolveState(originalMessage, actionResult, { action, expectedUrl: url });
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

        const resolved = await this.resolveState(originalMessage, actionResult, { action, expectedUrl: url });
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

  async resolveState(message: string, actionResult: ActionResult, opts?: { action?: Action; expectedUrl?: string }): Promise<boolean> {
    tag('info').log('AI Navigator resolving state at', actionResult.url);
    debugLog('Resolution message:', message);

    const action = opts?.action ?? this.explorer.createAction();
    const expectedUrl = opts?.expectedUrl;

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

    if (!actionResult.isInsideIframe) {
      const successful = this.experienceTracker.getSuccessfulExperience(actionResult);
      if (successful.length > 0) {
        tag('substep').log(`Found ${successful.length} experience ${pluralize(successful.length, 'file')} for: ${actionResult.url}`);
        experience = `<experience>\nPast successful recipes recorded from prior runs for this page. Prefer these solutions first if they match the goal.\n\n${successful.join('\n\n')}\n</experience>`;
      }
    }

    const prompt = dedent`
      <message>
        ${message}
      </message>

      <page>
        ${actionResult.toAiContext()}

        <page_html>
        ${await actionResult.combinedHtml()}
        </page_html>
      </page>

      <task>
        Identify the actual request of the user.
        Identify what is expected by user.
        Identify what might have caused the error.
        Propose different solutions to achieve the result.
        Solution should be valid CodeceptJS code.
        Use only data from the <page> context to plan the solution.
        Try various ways to achieve the result
      </task>

      ${actionRule}

      ${unexpectedPopupRule}

      ${RulesLoader.loadRules('navigator', ['multiple-locator', 'output'], actionResult.url || '').replace('{{maxAttempts}}', String(this.MAX_ATTEMPTS))}

      ${experience}

      ${knowledge}
    `;

    const conversation = this.provider.startConversation(this.systemPrompt, 'navigator');
    conversation.addUserText(prompt);

    const tools = undefined;

    let codeBlocks: string[] = [];
    let htmlContextAdded = false;
    let codeBlockIndex = 0;
    let totalAttempts = 0;
    const progressBlocks: string[] = [];
    const batchFailures: Array<{ code: string; error: string }> = [];

    let resolved = false;
    await loop(
      async ({ stop }) => {
        if (codeBlocks.length === 0) {
          const result = await this.provider.invokeConversation(conversation, tools);
          if (!result) return;
          const aiResponse = result?.response?.text;
          debugLog('AI:', aiResponse?.split('\n')[0]);
          debugLog('Received AI response:', aiResponse?.length ?? 0, 'characters');
          codeBlocks = extractCodeBlocks(aiResponse ?? '');
          codeBlockIndex = 0;
        }

        if (codeBlocks.length === 0) {
          stop();
          return;
        }

        const codeBlock = codeBlocks[codeBlockIndex];
        if (!codeBlock) {
          if (batchFailures.length === 0 && htmlContextAdded) {
            stop();
            return;
          }
          tag('substep').log('Feeding failures back to AI for a new batch...');
          let contextMsg = 'Previous solutions did not work. Analyze the failures and try DIFFERENT strategies (not syntactic variants of the same locator).\n\n';
          if (batchFailures.length > 0) {
            const lines = batchFailures.map((f) => `- \`${f.code.split('\n')[0]}\` → ${f.error}`).join('\n');
            contextMsg += `<previous_failures>\n${lines}\n</previous_failures>\n\n`;
          }
          if (!htmlContextAdded) {
            htmlContextAdded = true;
            contextMsg += `Full HTML context:\n\n<page_html>\n${await actionResult.combinedHtml()}\n</page_html>\n\n`;
          }
          contextMsg += 'Propose new solutions. If errors mention "intercepts pointer events" or timeouts on visible elements, an overlay is blocking — dismiss it first (Escape, click outside, Close button) before retrying the original action.';
          conversation.addUserText(contextMsg);
          codeBlocks = [];
          batchFailures.length = 0;
          return;
        }
        codeBlockIndex++;
        totalAttempts++;

        await this.explorer.switchToMainFrame();

        const prevHash = action.actionResult?.getStateHash() ?? actionResult.getStateHash();

        debugLog(`Attempting resolution: ${codeBlock}`);
        const attemptOk = await action.attempt(codeBlock, message);

        const page = action.playwrightHelper?.page;
        if (page) {
          try {
            await page.waitForLoadState('load', { timeout: 5000 });
          } catch {
            // Navigation did not reach 'load' state within timeout; continue and verify URL
          }
        }

        if (!attemptOk) {
          const raw = action.lastError?.message || 'attempt failed';
          const firstMeaningful = raw.split('\n').find((l) => l.trim() && !l.trim().startsWith('at ')) || raw;
          const shortErr = firstMeaningful.replace(/\s+/g, ' ').trim().slice(0, 220);
          batchFailures.push({ code: codeBlock, error: shortErr });
        }

        if (expectedUrl) {
          if (page) {
            try {
              await page.waitForURL((url: URL) => normalizeUrl(url.pathname) === normalizeUrl(expectedUrl), { timeout: 5000 });
            } catch {
              // URL did not transition to expectedUrl within timeout
            }
          }
          const freshState = await action.capturePageState();
          const urlMatches = normalizeUrl(freshState.url || '') === normalizeUrl(expectedUrl);
          const stateChanged = freshState.getStateHash() !== actionResult.getStateHash();
          resolved = urlMatches && stateChanged;

          if (!resolved && attemptOk) {
            tag('warning').log(`URL verification failed: expected ${expectedUrl}, got ${freshState.url}`);
          }
          if (freshState.getStateHash() !== prevHash && (attemptOk || urlMatches)) {
            progressBlocks.push(codeBlock);
          }
        } else {
          resolved = attemptOk;
          if (attemptOk) progressBlocks.push(codeBlock);
        }

        if (resolved) {
          tag('success').log('Navigation resolved successfully');
          let scenario = message.split('\n')[0];
          if (expectedUrl) {
            const fromPath = extractStatePath(actionResult.url || '');
            const toPath = extractStatePath(expectedUrl);
            scenario = `reach ${toPath} from ${fromPath}`;
          }
          const recipe = progressBlocks
            .join('\n')
            .split('\n')
            .filter((line) => !/^\s*I\.amOnPage\s*\(/.test(line))
            .join('\n')
            .trim();
          if (recipe) {
            const body = `## FLOW: ${scenario}\n\n* ${scenario}\n\n\`\`\`js\n${recipe}\n\`\`\`\n\n---\n`;
            this.experienceTracker.writeFlow(actionResult, body);
          }
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

    if (!resolved && expectedUrl) {
      await (action.getActor() as any).wait(1);
      if (this.isOnExpectedPage(expectedUrl, action.stateManager)) {
        resolved = true;
        tag('success').log('Navigation resolved after delayed redirect');
      }
    }

    if (!resolved && totalAttempts > 0) {
      tag('error').log(`Navigation failed after ${totalAttempts} attempts`);
    }

    if (!resolved && isInteractive()) {
      const userInput = await pause(`Navigator failed to resolve. Current: ${action.stateManager.getCurrentState()?.url}\n` + `Target: ${expectedUrl ?? '(none)'}\nEnter CodeceptJS commands (or press Enter to skip):`);

      if (userInput?.trim()) {
        resolved = await action.attempt(userInput, message);
        if (resolved && expectedUrl) {
          await (action.getActor() as any).wait(1);
          if (!this.isOnExpectedPage(expectedUrl, action.stateManager)) {
            resolved = false;
          }
        }
      }
    }

    return resolved;
  }

  private buildExperienceTools(): { learn_experience: unknown } | undefined {
    const stateManager = this.explorer.getStateManager();
    const getState = () => {
      const s = stateManager.getCurrentState();
      return s ? ActionResult.fromState(s) : null;
    };
    const { learn_experience } = createAgentTools({
      explorer: this.explorer,
      researcher: null as unknown as Researcher,
      navigator: this,
      experienceTracker: this.experienceTracker,
      getState,
    });
    if (!learn_experience) return undefined;
    return { learn_experience };
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

  async verifyState(message: string, actionResult: ActionResult): Promise<{ verified: boolean; successfulCodes: string[]; assertionSteps: Array<{ name: string; args: any[] }>; totalAttempted: number }> {
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

    if (!actionResult.isInsideIframe) {
      const toc = this.experienceTracker.getExperienceTableOfContents(actionResult);
      if (toc.length > 0) {
        const totalSections = toc.reduce((sum, entry) => sum + entry.sections.length, 0);
        tag('substep').log(`Found ${toc.length} experience ${pluralize(toc.length, 'file')} (${totalSections} sections) for: ${actionResult.url}`);
        experience = renderExperienceToc(toc);
      }
    }

    const prompt = dedent`
      <message>
        ${message}
      </message>

      <page>
        ${actionResult.toAiContext()}

        <page_html>
        ${await actionResult.combinedHtml()}
        </page_html>
      </page>

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

      ${RulesLoader.loadRules('navigator', ['verification-actions'], actionResult.url || '')}

      ${experience}

      ${knowledge}
    `;

    debugLog('Sending verification prompt to AI provider');
    tag('debug').log('Prompt:', prompt);

    const conversation = this.provider.startConversation(this.systemPrompt, 'navigator');
    conversation.addUserText(prompt);

    const tools = this.buildExperienceTools();

    let codeBlocks: string[] = [];
    const successfulCodes: string[] = [];
    const assertionSteps: Array<{ name: string; args: any[] }> = [];

    const action = this.explorer.createAction();

    await loop(
      async ({ stop, iteration }) => {
        if (codeBlocks.length === 0) {
          const result = await this.provider.invokeConversation(conversation, tools);
          if (!result) return;
          const aiResponse = result?.response?.text;
          debugLog('Received AI response:', aiResponse?.length ?? 0, 'characters');
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

        await this.explorer.switchToMainFrame();

        const verified = await action.attempt(codeBlock, message, false);

        if (verified) {
          tag('success').log('Verification passed');
          successfulCodes.push(codeBlock);
          assertionSteps.push(...action.assertionSteps);
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

    return { verified, successfulCodes, assertionSteps, totalAttempted };
  }
}

export { Navigator };
