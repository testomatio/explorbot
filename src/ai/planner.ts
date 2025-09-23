import type { Provider } from './provider.js';
import type { StateManager } from '../state-manager.js';
import { tag, createDebug } from '../utils/logger.js';
import { setActivity } from '../activity.ts';
import type { WebPageState } from '../state-manager.js';
import { type Conversation, Message } from './conversation.js';
import type { ExperienceTracker } from '../experience-tracker.ts';
import { z } from 'zod';
import dedent from 'dedent';
import { stepCountIs, tool } from 'ai';

const debugLog = createDebug('explorbot:planner');

export interface Task {
  scenario: string;
  status: 'pending' | 'completed' | 'failed';
  priority: 'high' | 'medium' | 'low' | 'unknown';
  expectedOutcome: string;
}

const AddScenarioTool = tool({
  description: 'Add a testing task with priority and expected outcome',
  inputSchema: z.object({
    scenario: z.string().describe('A single sentence describing what to test'),
    priority: z
      .string()
      .describe(
        'Priority of the task based on importance and risk. Must be one of: high, medium, low, unknown.'
      ),
    expectedOutcome: z
      .string()
      .describe('Expected result or behavior after executing the task'),
  }),
  execute: async (params: {
    scenario: string;
    priority: string;
    expectedOutcome: string;
  }) => {
    return {
      success: true,
      message: `Added task: ${params.scenario}`,
      task: params,
    };
  },
});

export class Planner {
  private provider: Provider;
  private stateManager: StateManager;

  constructor(provider: Provider, stateManager: StateManager) {
    this.provider = provider;
    this.stateManager = stateManager;
  }

  getSystemMessage(): string {
    return dedent`
    <role>
    You are manual QA planneing exporatary testing session of a web application.
    </role>
    <task>
      List possible testing scenarios for the web page.
    </task>
    `;
  }

  async plan(): Promise<Task[]> {
    const state = this.stateManager.getCurrentState();
    debugLog('Planning:', state?.url);
    if (!state) throw new Error('No state found');

    const prompt = this.buildPlanningPrompt(state);

    setActivity('👨‍💻 Planning...', 'action');

    const messages = [
      { role: 'user', content: this.getSystemMessage() },
      { role: 'user', content: prompt },
    ];

    if (state.researchResult) {
      messages.push({ role: 'user', content: state.researchResult });
    }

    messages.push({ role: 'user', content: this.getTasksMessage() });

    debugLog('Sending planning prompt to AI provider with tool calling');

    const tools = { AddScenario: AddScenarioTool };

    const tasks: Task[] = [];

    let proposeScenarios =
      'Suggest at least 3 scenarios which are relevant to the page and can be tested from UI.';

    let iteration = 0;
    while (tasks.length < 3) {
      if (iteration > 3) {
        break;
      }

      if (tasks.length > 0) {
        proposeScenarios = dedent`
          Call AddScenario tool and propose scenarios that are not already proposed

          Only propose scenarios that are not in this list:

          ${tasks.map((task) => task.scenario).join('\n')}
        `;
      }

      const result = await this.provider.generateWithTools(
        [...messages, { role: 'user', content: proposeScenarios }],
        tools,
        {
          stopWhen: stepCountIs(3),
          toolChoice: 'required',
          maxRetries: 3,
        }
      );

      debugLog('Tool results:', result.toolResults);

      for (const toolResult of result.toolResults) {
        if (
          toolResult.toolName === 'AddScenario' &&
          toolResult.output?.success
        ) {
          const taskData = toolResult.output.task;
          tasks.push({
            scenario: taskData.scenario,
            status: 'pending' as const,
            priority: taskData.priority,
            expectedOutcome: taskData.expectedOutcome,
          });
        }
      }

      iteration++;
    }

    if (tasks.length === 0) {
      throw new Error('No tasks were created successfully');
    }

    debugLog('Created tasks:', tasks);

    const priorityOrder = { high: 0, medium: 1, low: 2, unknown: 3 };
    const sortedTasks = [...tasks].sort(
      (a, b) =>
        (priorityOrder[
          a.priority.toLowerCase() as keyof typeof priorityOrder
        ] || 0) -
        (priorityOrder[
          b.priority.toLowerCase() as keyof typeof priorityOrder
        ] || 0)
    );

    return sortedTasks;
  }

  private buildPlanningPrompt(state: WebPageState): string {
    return dedent`Based on the previous research, create 3-7 exploratory testing scenarios for this page by calling the AddScenario tool multiple times.

      You MUST call the AddScenario tool multiple times to add individual tasks, one by one.

      When creating tasks:
      1. Assign priorities based on:
         - HIGH: Critical functionality, user flows, security-related, or high-risk features
         - MEDIUM: Important features that affect user experience but aren't critical
         - LOW: Edge cases, minor features, or nice-to-have validations
      2. Start with positive scenarios and then move to negative scenarios
      3. Focus on main content of the page, not in the menu, sidebar or footer
      4. Provide a good mix of high, medium, and low priority tasks
      5. For each task, specify what the expected outcome should be (e.g., "User should see success message", "Page should redirect to login", "Error message should appear")

      <rules>
      Scenarios must involve interaction with the web page (clicking, scrolling or typing).
      Scenarios must focus on business logic and functionality of the page.
      Propose business scenarios first, then technical scenarios.
      You can suggest scenarios that can be tested only through web interface.
      You can't test emails, database, SMS, or any external services.
      Suggest scenarios that can be potentially verified by UI.
      Focus on error or success messages as outcome.
      Focus on URL page change or data persistency after page reload.
      </rules>

      <context>
      URL: ${state.url || 'Unknown'}
      Title: ${state.title || 'Unknown'}

      HTML:
      ${state.html}
      </context>
    `;
  }

  getTasksMessage(): string {
    return dedent`
    <task>
      List possible testing scenarios for the web page by calling the AddScenario tool multiple times.
      You MUST call the AddScenario tool multiple times to add individual tasks, one by one.
      When creating tasks ensure all parameters are provided.
      1. Assign priorities based on:
         - HIGH: Critical functionality, user flows, security-related, or high-risk features
         - MEDIUM: Important features that affect user experience but aren't critical
         - LOW: Edge cases, minor features, or nice-to-have validations.
         If you are unsure about the priority, set it to LOW.
      2. Start with positive scenarios and then move to negative scenarios
      3. Focus on main content of the page, not in the menu, sidebar or footer
      4. Focus on tasks you are 100% sure relevant to this page and can be achived from UI.
      5. For each task, specify what the expected outcome should be (e.g., "User should see success message", "Page should redirect to login", "Error message should appear")
      6. Only tasks that can be tested from web UI should be proposed.
      7. At least 3 tasks should be proposed.
    </task>
    `;
  }
}
