import { tool } from 'ai';
import dedent from 'dedent';
import { z } from 'zod';
import { ActionResult } from '../action-result.js';
import { ExperienceTracker } from '../experience-tracker.js';
import type { ExplorBot } from '../explorbot.ts';
import type { WebPageState } from '../state-manager.ts';
import { Task, Test } from '../test-plan.ts';
import { HooksRunner } from '../utils/hooks-runner.ts';
import { createDebug, tag } from '../utils/logger.js';
import { loop } from '../utils/loop.js';
import type { Agent } from './agent.js';
import { createCaptainTools } from './captain-tools.ts';
import type { Conversation } from './conversation.js';
import type { Navigator } from './navigator.ts';
import type { Provider } from './provider.ts';
import { actionRule, locatorRule, sectionContextRule } from './rules.ts';
import { TaskAgent } from './task-agent.ts';
import { createAgentTools, createCodeceptJSTools } from './tools.ts';

const debugLog = createDebug('explorbot:captain');

const MAX_STEPS = 15;

export class Captain extends TaskAgent implements Agent {
  protected readonly ACTION_TOOLS = ['click', 'pressKey', 'form', 'navigate', 'record'];
  emoji = '🧑‍✈️';
  private explorBot: ExplorBot;
  private conversation: Conversation | null = null;
  private experienceTracker: ExperienceTracker;
  private awaitingSave = false;
  private pendingExperience: { state: ActionResult; intent: string; summary: string; code: string } | null = null;
  private hooksRunner: HooksRunner | null = null;
  private commandExecutor: ((cmd: string) => Promise<void>) | null = null;

  constructor(explorBot: ExplorBot) {
    super();
    this.explorBot = explorBot;
    this.experienceTracker = new ExperienceTracker();
  }

  setCommandExecutor(fn: (cmd: string) => Promise<void>): void {
    this.commandExecutor = fn;
  }

  private getHooksRunner(): HooksRunner {
    if (!this.hooksRunner) {
      const explorer = this.explorBot.getExplorer();
      this.hooksRunner = new HooksRunner(explorer, explorer.getConfig());
    }
    return this.hooksRunner;
  }

  protected getNavigator(): Navigator {
    return this.explorBot.agentNavigator();
  }

  protected getExperienceTracker(): ExperienceTracker {
    return this.experienceTracker;
  }

  protected getKnowledgeTracker() {
    return this.explorBot.getExplorer().getKnowledgeTracker();
  }

  protected getProvider(): Provider {
    return this.explorBot.getProvider();
  }

  private systemPrompt(): string {
    const customPrompt = this.explorBot.getProvider().getSystemPromptForAgent('captain');
    return dedent`
    <role>
    You are Captain — a smart assistant for the testing session.
    You execute actions, answer questions, diagnose problems, and run commands.
    </role>

    <capabilities>
    - Page actions: click, pressKey, navigate, form (CodeceptJS tools)
    - TUI commands: runCommand() — /research, /plan, /test, /navigate, /explore, etc.
    - Test inspection: test() — flags: --session, --log, --tools, --states, --aria, --code, --pilot
    - Browser diagnostics: browser() — evaluate JS, close tabs, screenshot, reload
    - File access: readFile, writeFile, listFiles — knowledge/experience/output
    - Research: getResearch() — cached UI map (no AI cost)
    - Session log: getSessionLog() — recent events and errors
    </capabilities>

    <diagnostic_workflow>
    When user asks "why did X fail?":
    1. Check <plan> context — find the test sessionName
    2. test --session <name> — get notes (passed/failed steps)
    3. test --session <name> --tools --last 5 — recent tool calls with ariaChanges
    4. test --session <name> --pilot — Pilot's analysis
    5. browser screenshot — see current page state visually
    6. If needed: test --session <name> --aria N — ARIA of a specific visited state

    When user asks about the page:
    1. getResearch() first (free, cached)
    2. If no cache: runCommand("/research")
    3. browser evaluate — for runtime state (localStorage, cookies)
    </diagnostic_workflow>

    <rules>
    - Answer questions using diagnostic tools BEFORE taking page actions
    - Use test() with minimal flags first, drill down only if needed
    - Prefer getResearch() over research() tool (cached, no AI cost)
    - Prefer ARIA over HTML — avoid full HTML reads
    - Use browser() for runtime diagnostics (localStorage, cookies, console, tabs)
    - After each page action, call record() to log what you did
    - Check if the expected result is achieved
    - If the goal is achieved — call done() immediately
    - Follow <locator_priority> rules when selecting locators for all tools
    - click() accepts array of commands to try in order — include ARIA, CSS, XPath variants
    - If click() fails with all provided commands, use visualClick() tool as fallback
    </rules>

    ${locatorRule}

    ${actionRule}

    ${sectionContextRule}

    ${customPrompt || ''}
    `;
  }

  private resetConversation(): Conversation {
    const agenticModel = this.explorBot.getProvider().getAgenticModel('captain');
    this.conversation = this.explorBot.getProvider().startConversation(this.systemPrompt(), 'captain', agenticModel);
    return this.conversation;
  }

  private ensureConversation(): Conversation {
    if (!this.conversation) {
      return this.resetConversation();
    }
    return this.conversation;
  }

  getConversation(): Conversation | null {
    return this.conversation;
  }

  cleanConversation(): void {
    this.conversation = null;
    tag('info').log(this.emoji, 'Conversation cleaned');
  }

  private async getPageContext(): Promise<string> {
    const state = this.explorBot.getExplorer().getStateManager().getCurrentState();
    if (!state) {
      return 'No page loaded';
    }

    const actionResult = ActionResult.fromState(state);
    const knowledge = this.getKnowledge(actionResult);
    const experience = this.getExperience(actionResult);

    return dedent`
    <page>
    URL: ${state.url || '/'}
    Title: ${state.title || 'Untitled'}

    <page_aria>
    ${actionResult.ariaSnapshot}
    </page_aria>
    </page>

    ${knowledge}

    ${experience}

    Use research() tool if you need deeper page understanding or UI element mapping.
    `;
  }

  private planSummary(): string {
    const plan = this.explorBot.getCurrentPlan();
    if (!plan || plan.tests.length === 0) {
      return '';
    }
    return dedent`
    <plan>
    ${plan.tests
      .map((test) => {
        const parts = [`[${test.priority}] ${test.scenario}`];
        if (test.sessionName) parts.push(`session=${test.sessionName}`);
        if (test.status !== 'pending') parts.push(`status=${test.status}`);
        if (test.result) parts.push(`result=${test.result}`);
        return parts.join(' | ');
      })
      .join('\n')}
    </plan>
    `;
  }

  private async reinjectContextIfNeeded(conversation: Conversation, currentState: WebPageState): Promise<void> {
    if (conversation.hasTag('page_html', 5)) return Promise.resolve();

    const actionResult = ActionResult.fromState(currentState);
    const html = await actionResult.combinedHtml();
    const context = dedent`
        Context:

        <page>
        CURRENT URL: ${currentState.url}
        CURRENT TITLE: ${currentState.title}
        </page>

        <page_aria>
        ${actionResult.ariaSnapshot}
        </page_aria>

        <page_html>
        ${html}
        </page_html>
      `;
    conversation.addUserText(context);
    return Promise.resolve();
  }

  private ownTools(task: Task, onDone: (summary: string) => void) {
    return {
      navigate: tool({
        description: 'Navigate to a page or state using AI navigator',
        inputSchema: z.object({ target: z.string().min(1).describe('URL or known state identifier') }),
        execute: async ({ target }) => {
          debugLog('navigate', target);
          tag('step').log(`Navigating to ${target}`);
          task.addStep(`Navigate to ${target}`);
          await this.explorBot.agentNavigator().visit(target);
          return { success: true, target };
        },
      }),
      record: tool({
        description: 'Record what action was performed. Use after each action.',
        inputSchema: z.object({
          note: z.string().describe('Short description of what was done (max 15 words)'),
        }),
        execute: async ({ note }) => {
          debugLog('record', note);
          task.addNote(note);
          tag('substep').log(`📝 ${note}`);
          return { success: true, note };
        },
      }),
      done: tool({
        description: 'Call when the user request is fulfilled.',
        inputSchema: z.object({
          summary: z.string().describe('What was done'),
        }),
        execute: async ({ summary }) => {
          debugLog('done', summary);
          task.addNote(summary);
          onDone(summary);
          return { success: true, summary };
        },
      }),
      plan: tool({
        description: 'Generate or refresh the exploratory test plan',
        inputSchema: z.object({ feature: z.string().optional().describe('Optional feature or focus area') }),
        execute: async ({ feature }) => {
          debugLog('plan', feature);
          if (feature) {
            tag('substep').log(`Captain planning focus: ${feature}`);
          }
          const newPlan = await this.explorBot.agentPlanner().plan();
          return { success: true, tests: newPlan?.tests.length || 0 };
        },
      }),
      updatePlan: tool({
        description: 'Update the current plan by replacing or appending tests',
        inputSchema: z.object({
          action: z.enum(['replace', 'append']).optional().describe('replace clears existing tests, append keeps them'),
          title: z.string().optional().describe('New plan title'),
          tests: z
            .array(
              z.object({
                scenario: z.string(),
                priority: z.enum(['critical', 'important', 'high', 'normal', 'low']).optional(),
                expected: z.array(z.string()).optional(),
              })
            )
            .optional(),
        }),
        execute: async ({ action, title, tests }) => {
          let plan = this.explorBot.getCurrentPlan();
          if (!plan) {
            plan = await this.explorBot.plan();
          }
          if (!plan) {
            return { success: false, message: 'Plan unavailable' };
          }
          if (title) {
            plan.title = title;
          }
          if (tests?.length) {
            if (!action || action === 'replace') {
              plan.tests.length = 0;
            }
            const currentUrl = this.explorBot.getExplorer().getStateManager().getCurrentState()?.url || '';
            for (const testInput of tests) {
              const priority = testInput.priority || 'normal';
              const expected = testInput.expected?.length ? testInput.expected : [];
              const test = new Test(testInput.scenario, priority, expected, currentUrl);
              plan.addTest(test);
            }
          }
          plan.updateStatus();
          return { success: true, tests: plan.tests.length };
        },
      }),
    };
  }

  private tools(task: Task, onDone: (summary: string) => void) {
    const explorer = this.explorBot.getExplorer();
    const codeceptjsTools = createCodeceptJSTools(explorer, task);

    const agentTools = createAgentTools({
      explorer,
      researcher: this.explorBot.agentResearcher(),
      navigator: this.explorBot.agentNavigator(),
    });

    const ownTools = this.ownTools(task, onDone);

    const captainTools = createCaptainTools({
      explorBot: this.explorBot,
      commandExecutor: this.commandExecutor,
    });

    return {
      ...codeceptjsTools,
      ...agentTools,
      ...ownTools,
      ...captainTools,
    };
  }

  private collectSteps(startIndex: number): string[] {
    const history = this.explorBot.getExplorer().getStateManager().getStateHistory().slice(startIndex);
    return history
      .map((transition) => transition.codeBlock)
      .filter((block) => block)
      .flatMap((block) => block.split('\n'))
      .map((step) => step.trim())
      .filter((step) => step);
  }

  private async handleSaveResponse(input: string): Promise<string | null> {
    if (!this.pendingExperience) {
      this.awaitingSave = false;
      return null;
    }
    const normalized = input.trim().toLowerCase();
    if (normalized === 'y' || normalized === 'yes') {
      await this.experienceTracker.saveSuccessfulResolution(this.pendingExperience.state, this.pendingExperience.intent, this.pendingExperience.code, this.pendingExperience.summary);
      tag('success').log(this.emoji, 'Saved to experience');
      this.awaitingSave = false;
      this.pendingExperience = null;
      return 'Saved';
    }
    if (normalized === 'n' || normalized === 'no') {
      tag('info').log(this.emoji, 'Skipped saving to experience');
      this.awaitingSave = false;
      this.pendingExperience = null;
      return 'Skipped';
    }
    const prompt = 'Save this solution to experience? (yes/no)';
    tag('info').log(this.emoji, prompt);
    return prompt;
  }

  async handle(input: string, options: { reset?: boolean } = {}): Promise<string | null> {
    if (this.awaitingSave) {
      return await this.handleSaveResponse(input);
    }

    const stateManager = this.explorBot.getExplorer().getStateManager();
    const currentState = stateManager.getCurrentState();

    if (!currentState) {
      tag('warning').log(this.emoji, 'No page loaded. Use /navigate or I.amOnPage() first.');
      return null;
    }

    const conversation = options.reset ? this.resetConversation() : this.ensureConversation();
    let isDone = false;
    let finalSummary: string | null = null;

    const startUrl = currentState.url || '';
    const initialActionResult = ActionResult.fromState(currentState);
    const task = new Task(input, startUrl);
    const historyStart = stateManager.getStateHistory().length;

    const onDone = (summary: string) => {
      isDone = true;
      finalSummary = summary;
    };

    const tools = this.tools(task, onDone);

    await this.getHooksRunner().runBeforeHook('captain', startUrl);

    const pageContext = await this.getPageContext();
    const planContext = this.planSummary();

    if (!options.reset && this.conversation) {
      conversation.cleanupTag('page_aria', '...cleaned...', 1);
      conversation.cleanupTag('page_html', '...cleaned...', 1);
    }

    const initialPrompt = dedent`
    ${pageContext}

    ${planContext}

    <request>
    ${input}
    </request>

    Execute the request using available tools. Call done() only after completing the action.
    `;

    conversation.addUserText(initialPrompt);
    tag('info').log(this.emoji, `Processing: ${input}`);

    await loop(
      async ({ stop, iteration, userInput }) => {
        debugLog(`Captain iteration ${iteration}`);

        if (isDone) {
          stop();
          return;
        }

        await this.reinjectContextIfNeeded(conversation, currentState);

        if (userInput) {
          const newContext = await this.getPageContext();
          conversation.addUserText(dedent`
            ${newContext}

            <user_redirect>
            ${userInput}
            </user_redirect>

            The user has interrupted and wants to change direction. Follow the new instruction.
          `);
        }

        const result = await this.explorBot.getProvider().invokeConversation(conversation, tools, {
          maxToolRoundtrips: 5,
          toolChoice: 'auto',
        });

        if (!result) {
          stop();
          return;
        }

        const toolNames = result?.toolExecutions?.map((e: any) => e.toolName) || [];
        debugLog('Tools called:', toolNames.join(', '));

        this.trackToolExecutions(result?.toolExecutions || []);

        if (isDone) {
          stop();
          return;
        }
      },
      {
        maxAttempts: MAX_STEPS,
        interruptPrompt: 'Captain interrupted. Enter new instruction (or "stop" to cancel):',
        observability: {
          agent: 'captain',
        },
        catch: async ({ error, stop }) => {
          tag('error').log(`Captain error: ${error}`);
          stop();
        },
      }
    );

    const finalUrl = stateManager.getCurrentState()?.url || startUrl;
    await this.getHooksRunner().runAfterHook('captain', finalUrl);

    if (finalSummary) {
      tag('success').log(this.emoji, finalSummary);
    } else {
      tag('warning').log(this.emoji, 'Request may not be fully completed');
    }

    await this.getHistorian().saveSession(task, initialActionResult, conversation);
    await this.getQuartermaster().analyzeSession(task, initialActionResult, conversation);

    const notes = task.getPrintableNotes();
    if (notes.length > 0) {
      tag('multiline').log(`Task log:\n${notes.join('\n')}`);
    }

    if (finalSummary) {
      const steps = this.collectSteps(historyStart);
      if (steps.length > 0) {
        const summaryLine = (finalSummary as string).split('\n')[0];
        this.pendingExperience = {
          state: initialActionResult,
          intent: input,
          summary: summaryLine,
          code: steps.join('\n'),
        };
        this.awaitingSave = true;
        const prompt = 'Save this solution to experience? (yes/no)';
        tag('info').log(this.emoji, prompt);
        return prompt;
      }
    }

    return finalSummary;
  }
}

export default Captain;
