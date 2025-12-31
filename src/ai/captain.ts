import { tool } from 'ai';
import dedent from 'dedent';
import { z } from 'zod';
import { ActionResult } from '../action-result.js';
import { ExperienceTracker } from '../experience-tracker.js';
import { executionController } from '../execution-controller.ts';
import type { ExplorBot } from '../explorbot.ts';
import { Task, Test } from '../test-plan.ts';
import { createDebug, tag } from '../utils/logger.js';
import { loop } from '../utils/loop.js';
import type { Agent } from './agent.js';
import type { Conversation } from './conversation.js';
import { createAgentTools, createCodeceptJSTools } from './tools.ts';
import { locatorRule } from './rules.ts';

const debugLog = createDebug('explorbot:captain');

const MAX_STEPS = 5;
const ACTION_TOOLS = ['click', 'clickByText', 'clickXY', 'type', 'select', 'form', 'navigate', 'record'];

export class Captain implements Agent {
  emoji = '🧑‍✈️';
  private explorBot: ExplorBot;
  private conversation: Conversation | null = null;
  private experienceTracker: ExperienceTracker;
  private awaitingSave = false;
  private pendingExperience: { state: ActionResult; intent: string; summary: string; code: string } | null = null;

  constructor(explorBot: ExplorBot) {
    this.explorBot = explorBot;
    this.experienceTracker = new ExperienceTracker();
  }

  private systemPrompt(): string {
    return dedent`
    <role>
    You execute exactly what the user asks - nothing more.
    </role>

    ${locatorRule}

    <rules>
    - Do the MINIMUM required to fulfill the request
    - After each action, call record() to log what you did
    - Check if the expected result is achieved
    - If the goal is achieved (correct page, correct state) - call done() immediately
    - If the action worked but result is not as expected - try next action
    - Do NOT add extra steps beyond what was asked
    - Start with currently focused/visible area on the page
    - Always validate page HTML/ARIA and ask for see() to verify that the page is in the expected state
    - Follow <locator_priority> rules when selecting locators for all tools
    </rules>

    `;
  }

  private resetConversation(): Conversation {
    this.conversation = this.explorBot.getProvider().startConversation(this.systemPrompt(), 'captain');
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

  private async getPageContext(): Promise<string> {
    const state = this.explorBot.getExplorer().getStateManager().getCurrentState();
    if (!state) {
      return 'No page loaded';
    }

    const actionResult = ActionResult.fromState(state);
    const html = await actionResult.simplifiedHtml();
    const aria = state.ariaSnapshot || '';

    return dedent`
    <page>
    URL: ${state.url || '/'}
    Title: ${state.title || 'Untitled'}

    <page_aria>
    ${aria}
    </page_aria>

    <page_html>
    ${html}
    </page_html>
    </page>
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
      .map((test, index) => {
        const parts = [`${index + 1}. [${test.priority}] ${test.scenario}`];
        if (test.status !== 'pending') {
          parts.push(`status=${test.status}`);
        }
        return parts.join(' | ');
      })
      .join('\n')}
    </plan>
    `;
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
                priority: z.enum(['high', 'medium', 'low', 'unknown']).optional(),
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
              const priority = testInput.priority || 'unknown';
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
    const codeceptjsTools = createCodeceptJSTools(explorer, (note) => {
      task.addNote(note);
      tag('substep').log(note);
    });

    const agentTools = createAgentTools({
      explorer,
      researcher: this.explorBot.agentResearcher(),
      navigator: this.explorBot.agentNavigator(),
    });

    const ownTools = this.ownTools(task, onDone);

    return {
      ...codeceptjsTools,
      ...agentTools,
      ...ownTools,
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
    const pageContext = await this.getPageContext();
    const planContext = this.planSummary();

    // Clean up old page context from previous inputs when continuing conversation
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
      async ({ stop, iteration }) => {
        debugLog(`Captain iteration ${iteration}`);

        if (isDone) {
          stop();
          return;
        }

        if (!conversation.hasTag('page_html', 5)) {
          conversation.addUserText(dedent`
            Context:

            <page>
            CURRENT URL: ${currentState.url}
            CURRENT TITLE: ${currentState.title}
            </page>

            <page_aria>
            ${currentState.ariaSnapshot}
            </page_aria>

            <page_html>
            ${currentState.html}
            </page_html>
          `);
        }

        const interruptInput = await executionController.checkInterrupt();
        if (interruptInput) {
          const newContext = await this.getPageContext();
          conversation.addUserText(dedent`
            ${newContext}

            <user_redirect>
            ${interruptInput}
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
        const actionPerformed = toolNames.some((name: string) => ACTION_TOOLS.includes(name));

        debugLog('Tools called:', toolNames.join(', '));

        if (isDone) {
          stop();
          return;
        }

        if (iteration >= MAX_STEPS) {
          tag('warning').log('Max steps reached');
          stop();
          return;
        }

        if (actionPerformed && !isDone) {
          conversation.cleanupTag('page_aria', '...cleaned...', 1);
          conversation.cleanupTag('page_html', '...cleaned...', 1);

          const newContext = await this.getPageContext();
          conversation.addUserText(dedent`
            Action completed. Page state:
            ${newContext}

            If the request is fulfilled, call done(summary) NOW.
            Only continue if the original request is NOT yet complete.
          `);
        }
      },
      {
        maxAttempts: MAX_STEPS,
        observability: {
          agent: 'captain',
        },
        catch: async ({ error, stop }) => {
          tag('error').log(`Captain error: ${error}`);
          stop();
        },
      }
    );

    if (finalSummary) {
      tag('success').log(this.emoji, finalSummary);
    } else {
      tag('warning').log(this.emoji, 'Request may not be fully completed');
    }

    const notes = task.getPrintableNotes();
    if (notes.length > 0) {
      tag('multiline').log(`Task log:\n${notes.join('\n')}`);
    }

    if (finalSummary && initialActionResult) {
      const steps = this.collectSteps(historyStart);
      if (steps.length > 0) {
        const summaryLine = finalSummary.split('\n')[0];
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
