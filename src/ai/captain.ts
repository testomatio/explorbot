import { tool } from 'ai';
import dedent from 'dedent';
import { z } from 'zod';
import { ActionResult } from '../action-result.js';
import type { ExperienceTracker } from '../experience-tracker.js';
import type { ExplorBot } from '../explorbot.ts';
import type { WebPageState } from '../state-manager.ts';
import { Task, Test } from '../test-plan.ts';
import { HooksRunner } from '../utils/hooks-runner.ts';
import { startLogCapture, stopLogCapture, tag } from '../utils/logger.js';
import { loop } from '../utils/loop.js';
import { truncateJson } from '../utils/strings.ts';
import type { Agent } from './agent.js';
import { WithIdleMode } from './captain/idle-mode.ts';
import { type CaptainMode, type ModeContext, debugLog } from './captain/mixin.ts';
import { WithTestMode } from './captain/test-mode.ts';
import { WithWebMode } from './captain/web-mode.ts';
import { type Conversation, toolExecutionLabel } from './conversation.js';
import type { Navigator } from './navigator.ts';
import type { Provider } from './provider.ts';
import { Researcher } from './researcher.ts';
import { TaskAgent } from './task-agent.ts';

const MAX_STEPS = 15;

const CaptainBase = WithTestMode(WithWebMode(WithIdleMode(TaskAgent as unknown as new (...args: any[]) => TaskAgent)));

export class Captain extends CaptainBase implements Agent {
  emoji = '🧑‍✈️';
  private explorBot: ExplorBot;
  private conversation: Conversation | null = null;
  private experienceTracker: ExperienceTracker;
  private hooksRunner: HooksRunner | null = null;
  private commandExecutor: ((cmd: string) => Promise<void>) | null = null;
  private commandDescriptions: { name: string; description: string; options: string }[] = [];

  constructor(explorBot: ExplorBot) {
    super();
    this.explorBot = explorBot;
    this.experienceTracker = explorBot.experienceTracker();
  }

  setCommandExecutor(fn: (cmd: string) => Promise<void>, descriptions: { name: string; description: string; options: string }[]): void {
    this.commandExecutor = fn;
    this.commandDescriptions = descriptions;
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
    return this.explorBot.knowledgeTracker();
  }

  protected getProvider(): Provider {
    return this.explorBot.getProvider();
  }

  protected trackToolExecutions(toolExecutions: any[]): void {
    super.trackToolExecutions(toolExecutions);
    if (toolExecutions.length > 0) {
      this.recentToolCalls.push(...toolExecutions);
      if (this.recentToolCalls.length > 20) {
        this.recentToolCalls = this.recentToolCalls.slice(-20);
      }
    }
    for (const exec of toolExecutions) {
      const label = toolExecutionLabel(exec.input);
      if (!label) continue;
      const icon = exec.wasSuccessful ? '→' : '✗';
      tag('substep').log(`${icon} ${label}`);
    }
  }

  getMode(): CaptainMode {
    const explorer = this.explorBot.getExplorer();
    const activeTest = explorer.activeTest;
    const page = explorer.playwrightHelper?.page;

    if (activeTest && (!page || page.isClosed?.())) return 'heal';
    if (activeTest) return 'test';
    if (explorer.getStateManager().getCurrentState()) return 'web';
    return 'idle';
  }

  private systemPrompt(): string {
    const mode = this.getMode();
    const currentUrl = this.explorBot.getExplorer().getStateManager().getCurrentState()?.url;
    const customPrompt = this.explorBot.getProvider().getSystemPromptForAgent('captain', currentUrl);

    return dedent`
    <role>
    You are Captain — a smart assistant for the testing session.
    Current mode: ${mode}. ${mode === 'test' ? 'A test is running.' : ''}
    </role>

    <modes>
    - idle: plan management, file operations, knowledge. Always available.
    - web: page interaction, navigation, browser diagnostics. When working with a web page.
    - test: test analysis, state inspection. When a test is running or analyzing results.
    - heal: browser/test recovery. When a test is running and browser state is broken or unavailable.
    </modes>

    ${this.idleModePrompt()}
    ${mode === 'web' || mode === 'heal' ? this.webModePrompt() : ''}
    ${mode === 'test' || mode === 'heal' ? this.testModePrompt() : ''}

    <rules>
    - After a successful action, if the pageDiff confirms the goal, call done() immediately — do not verify with see() or context() unless the user explicitly asked for verification
    - Prefer completing in fewer tool calls over thoroughness
    - NEVER run tests unless the user explicitly asks
    - If you are answering with information rather than completing a browser action, include the actual user-facing answer in done({ details }). Do not only say that it was shown or explained.
    ${mode === 'web' || mode === 'heal' ? this.webModeRules() : ''}
    ${mode === 'test' || mode === 'heal' ? this.testModeRules() : ''}
    ${mode === 'heal' ? '- First diagnose browser availability, then recover the browser/page before continuing test analysis.' : ''}
    </rules>

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
    tag('info').log('Conversation cleaned');
  }

  private async getPageContext(): Promise<string> {
    const state = this.explorBot.getExplorer().getStateManager().getCurrentState();
    if (!state) {
      return 'No page loaded';
    }

    const actionResult = ActionResult.fromState(state);
    const knowledge = this.getKnowledge(actionResult);
    const experience = this.getExperience(actionResult);

    const headingLines: string[] = [];
    if (state.h1) headingLines.push(`H1: ${state.h1}`);
    if (state.h2) headingLines.push(`H2: ${state.h2}`);
    if (state.h3) headingLines.push(`H3: ${state.h3}`);
    if (state.h4) headingLines.push(`H4: ${state.h4}`);
    const headingsBlock = headingLines.join('\n');

    let pageSummary = '';
    const cachedResearch = Researcher.getCachedResearch(state);
    if (cachedResearch) {
      pageSummary = `<page_summary>\n${this.explorBot.agentResearcher().extractBrief(cachedResearch)}\n</page_summary>`;
    }

    const activeTest = this.explorBot.getExplorer().activeTest;
    let activeTestContext = '';
    if (activeTest) {
      activeTestContext = dedent`
        <active_test>
        Session: ${activeTest.sessionName}
        Scenario: ${activeTest.scenario}
        Status: ${activeTest.status}
        Result: ${activeTest.result || 'pending'}
        Start URL: ${activeTest.startUrl}
        </active_test>
      `;
    }

    return dedent`
    <page>
    URL: ${state.url || '/'}
    Title: ${state.title || 'Untitled'}
    ${headingsBlock}

    <page_aria>
    ${actionResult.getInteractiveARIA()}
    </page_aria>
    </page>

    ${pageSummary}

    ${activeTestContext}

    ${knowledge}

    ${experience}
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
        ${actionResult.getInteractiveARIA()}
        </page_aria>

        <page_html>
        ${html}
        </page_html>
      `;
    conversation.addUserText(context);
    return Promise.resolve();
  }

  private coreTools(task: Task, onDone: (summary: string) => void) {
    return {
      done: tool({
        description: 'Call when the user request is fulfilled.',
        inputSchema: z.object({
          summary: z.string().describe('What was done'),
          details: z.string().optional().describe('Actual user-facing content. Required when the user asked to show, display, explain, summarize, compare, or diagnose information.'),
        }),
        execute: async ({ summary, details }) => {
          debugLog('done', summary);
          if (!details?.trim() && !this.canCompleteWithoutDetails()) {
            return {
              success: false,
              message: 'No user-facing result was provided. Call done() again with the actual answer in details, or complete a browser action first.',
            };
          }
          if (details?.trim()) {
            tag('details').log(details);
            task.addNote(details);
          }
          task.addNote(summary);
          onDone(summary);
          return { success: true, summary };
        },
      }),
      runCommand: tool({
        description: dedent`
          Execute a TUI command. Returns log output from command execution.
          Use only when the user explicitly asks to run a slash command.
          Never use this to analyze files, reports, logs, plans, generated tests, knowledge, or experience.
          Never run a slash command unless the user request itself starts with that slash command.
          ${this.commandDescriptions
            .map((c) => {
              const opts = c.options ? ` (${c.options})` : '';
              return `${c.name} — ${c.description}${opts}`;
            })
            .join('\n')}
        `,
        inputSchema: z.object({
          command: z.string().describe('Slash command to execute, e.g. "/research", "/plan authentication", "/test brave-fox123"'),
        }),
        execute: async ({ command }) => {
          if (!this.commandExecutor) return { success: false, message: 'Command executor not available' };
          const cmd = command.startsWith('/') ? command : `/${command}`;
          if (!isExplicitSlashRequest(task.description, cmd)) {
            return {
              success: false,
              command: cmd,
              message: 'Command blocked: slash commands require an explicit matching slash-command request from the user.',
            };
          }
          startLogCapture();
          try {
            await this.commandExecutor(cmd);
          } catch {}
          const logs = stopLogCapture();
          return { success: true, command: cmd, output: logs.join('\n') };
        },
      }),
    };
  }

  private async tools(task: Task, onDone: (summary: string) => void) {
    const mode = this.getMode();
    const ctx: ModeContext = { explorBot: this.explorBot, task };
    const core = this.coreTools(task, onDone);
    const idle = await this.idleModeTools(ctx);

    if (mode === 'heal') return { ...core, ...idle, ...this.testModeTools(ctx), ...this.webModeTools(ctx) };
    if (mode === 'test') return { ...core, ...idle, ...this.testModeTools(ctx) };
    if (mode === 'web') return { ...core, ...idle, ...this.webModeTools(ctx) };
    return { ...core, ...idle };
  }

  async processSupervisorInterrupt(userMessage: string, activeTest: Test): Promise<SupervisorAction> {
    const quickMatch = userMessage.trim().toLowerCase();
    if (/^(stop|abort|cancel)$/i.test(quickMatch)) {
      return { action: 'stop', message: 'Stopping test per user request' };
    }
    if (/^(pass|ok|approve)$/i.test(quickMatch)) {
      return { action: 'pass', message: 'Marking test as passed per user request' };
    }
    if (/^(skip|next)$/i.test(quickMatch)) {
      return { action: 'skip', message: 'Skipping test per user request' };
    }

    const testerConv = this.explorBot.agentTester().getConversation();
    let recentToolSummary = '';
    if (testerConv) {
      const execs = testerConv.getToolExecutions().slice(-5);
      recentToolSummary = execs.map((e) => `${e.toolName}: ${e.wasSuccessful ? 'ok' : 'fail'} ${truncateJson(e.input)}`).join('\n');
    }

    const pilotAnalysis = this.explorBot.agentPilot().getLastAnalysis() || '';
    const currentUrl = this.explorBot.getExplorer().getStateManager().getCurrentState()?.url || '';

    const schema = z.object({
      action: z.enum(['inject', 'stop', 'pass', 'skip']),
      message: z.string().describe('Message to pass to the tester or display to user'),
    });

    const model = this.explorBot.getProvider().getModelForAgent('captain');
    const result = await this.explorBot.getProvider().generateObject(
      [
        {
          role: 'system',
          content: dedent`
            You are a test supervisor. A test is running and the user has interrupted with a message.
            Decide what action to take based on the user's intent.

            Actions:
            - inject: Pass refined guidance to the tester (user wants to redirect, suggest, or help)
            - stop: Stop the test (user wants to abort)
            - pass: Mark test as passed (user confirms it's good)
            - skip: Skip this test (user wants to move to next)

            For "inject", rephrase the user's message as clear instructions for the AI tester.
          `,
        },
        {
          role: 'user',
          content: dedent`
            Test scenario: ${activeTest.scenario}
            Current URL: ${currentUrl}
            Recent tool executions:
            ${recentToolSummary || 'None'}
            ${pilotAnalysis ? `Pilot analysis: ${pilotAnalysis}` : ''}

            User message: ${userMessage}
          `,
        },
      ],
      schema,
      model
    );

    if (!result?.object) {
      return { action: 'inject', message: userMessage };
    }

    return result.object;
  }

  async processExecutionError(error: Error, activeTest: Test): Promise<ExecutionRecoveryAction> {
    const explorer = this.explorBot.getExplorer();
    const result = await explorer.handleExecutionError(error);
    return {
      ...result,
      message: result.recovered ? `${result.message}\nContinue the test "${activeTest.scenario}" from the restored page.` : result.message,
    };
  }

  private canCompleteWithoutDetails(): boolean {
    return (this.recentToolCalls || []).some(hasBrowserCompletionEvidence);
  }

  async handle(input: string, options: { reset?: boolean } = {}): Promise<string | null> {
    const stateManager = this.explorBot.getExplorer().getStateManager();
    const initialState = stateManager.getCurrentState();

    const conversation = options.reset ? this.resetConversation() : this.ensureConversation();
    let isDone = false;
    let finalSummary: string | null = null;

    const startUrl = initialState?.url || '';
    const task = new Task(input, startUrl);
    const onDone = (summary: string) => {
      isDone = true;
      finalSummary = summary;
    };

    const tools = await this.tools(task, onDone);

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

    Execute the request using available tools. After a successful action, check the pageDiff — if it confirms the goal, call done() immediately.
    `;

    conversation.addUserText(initialPrompt);

    await loop(
      async ({ stop, iteration, userInput }) => {
        debugLog(`Captain iteration ${iteration}`);

        if (isDone) {
          stop();
          return;
        }

        const currentState = stateManager.getCurrentState();
        if (!currentState && this.getMode() !== 'idle') {
          stop();
          return;
        }

        if (currentState) {
          await this.reinjectContextIfNeeded(conversation, currentState);
        }

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

        if (result?.toolExecutions?.length) {
          const lastExec = result.toolExecutions[result.toolExecutions.length - 1];
          if (hasBrowserCompletionEvidence(lastExec)) {
            conversation.addUserText('Action succeeded. If the goal is achieved, call done() now with a brief summary.');
          }
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
      tag('info').log(finalSummary);
    } else {
      tag('warning').log('Request may not be fully completed');
    }

    return null;
  }
}

export default Captain;

interface SupervisorAction {
  action: 'inject' | 'stop' | 'pass' | 'skip';
  message: string;
}

interface ExecutionRecoveryAction {
  action: 'continue' | 'stop';
  message: string;
  recovered?: boolean;
}

function isExplicitSlashRequest(input: string, command: string): boolean {
  const requested = slashCommandToken(input);
  const actual = slashCommandToken(command);
  if (!requested || !actual) return false;
  return requested === actual;
}

function slashCommandToken(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith('/')) return null;

  for (let i = 1; i < trimmed.length; i++) {
    if (trimmed[i] <= ' ') return trimmed.slice(0, i);
  }
  return trimmed;
}

function hasBrowserCompletionEvidence(execution: any): boolean {
  if (!execution?.wasSuccessful) return false;
  const output = execution.output || {};
  return Boolean(output.pageDiff || output.code || output.playwrightGroupId);
}
