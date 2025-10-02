import { tool } from 'ai';
import dedent from 'dedent';
import { z } from 'zod';
import type { ExplorBot } from '../explorbot.ts';
import { createDebug, tag } from '../utils/logger.js';
import { Test } from '../test-plan.ts';
import type { Agent } from './agent.js';
import { Conversation } from './conversation.js';

const debugLog = createDebug('explorbot:captain');

export class Captain implements Agent {
  emoji = '🧑‍✈️';
  private explorBot: ExplorBot;
  private conversation: Conversation | null = null;

  constructor(explorBot: ExplorBot) {
    this.explorBot = explorBot;
  }

  private systemPrompt(): string {
    return dedent`
    <role>
    You orchestrate exploratory testing by coordinating navigation, research, and planning.
    You manage the current browser state and keep the test plan up to date.
    </role>
    <tools>
    You can call navigate(target), plan(feature), research(target), updatePlan(action, title, tests).
    </tools>
    <instructions>
    Decide when to adjust the state, when to gather more information, and when to update the plan.
    Keep responses concise and focus on next actionable steps.
    </instructions>
    `;
  }

  private ensureConversation(): Conversation {
    if (!this.conversation) {
      this.conversation = this.explorBot.getProvider().startConversation(this.systemPrompt());
    }
    return this.conversation;
  }

  private stateSummary(): string {
    const manager = this.explorBot.getExplorer().getStateManager();
    const state = manager.getCurrentState();
    if (!state) {
      return 'Unknown state';
    }
    const lines = [`URL: ${state.url || '/'}`, `Title: ${state.title || 'Untitled'}`];
    if (state.researchResult) {
      lines.push(`Research: ${state.researchResult.slice(0, 500)}`);
    }
    return lines.join('\n');
  }

  private planSummary(): string {
    const plan = this.explorBot.getCurrentPlan();
    if (!plan || plan.tests.length === 0) {
      return 'No active plan';
    }
    return plan.tests
      .map((test, index) => {
        const parts = [`${index + 1}. [${test.priority}] ${test.scenario}`];
        if (test.status !== 'pending') {
          parts.push(`status=${test.status}`);
        }
        if (test.expected.length) {
          parts.push(`expected=${test.expected.slice(0, 3).join('; ')}`);
        }
        return parts.join(' | ');
      })
      .join('\n');
  }

  private tools() {
    return {
      navigate: tool({
        description: 'Navigate to a page or state using AI navigator',
        inputSchema: z.object({ target: z.string().min(1).describe('URL or known state identifier') }),
        execute: async ({ target }) => {
          debugLog('navigate', target);
          await this.explorBot.agentNavigator().visit(target);
          return { success: true, target };
        },
      }),
      research: tool({
        description: 'Research the current page or a provided target',
        inputSchema: z.object({ target: z.string().optional().describe('Optional URL to visit before research') }),
        execute: async ({ target }) => {
          debugLog('research', target);
          if (target) {
            await this.explorBot.visit(target);
          }
          const result = await this.explorBot.agentResearcher().research();
          return { success: true, summary: result.slice(0, 800) };
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
          const newPlan = await this.explorBot.plan();
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
          if (tests && tests.length) {
            if (!action || action === 'replace') {
              plan.tests.length = 0;
            }
            for (const testInput of tests) {
              const priority = testInput.priority || 'unknown';
              const expected = testInput.expected && testInput.expected.length ? testInput.expected : [];
              const test = new Test(testInput.scenario, priority, expected);
              plan.addTest(test);
            }
          }
          plan.updateStatus();
          return { success: true, tests: plan.tests.length };
        },
      }),
    };
  }

  async handle(input: string): Promise<string | null> {
    const conversation = this.ensureConversation();
    const prompt = dedent`
    <state>
    ${this.stateSummary()}
    </state>
    <plan>
    ${this.planSummary()}
    </plan>
    <request>
    ${input}
    </request>
    `;
    conversation.addUserText(prompt);
    const tools = this.tools();
    const result = await this.explorBot.getProvider().invokeConversation(conversation, tools, {
      maxToolRoundtrips: 5,
    });
    const responseText = result?.response?.text?.trim() || null;
    if (responseText) {
      tag('info').log(this.emoji, responseText);
    }
    return responseText;
  }
}

export default Captain;
