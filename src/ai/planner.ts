import type { Provider } from './provider.js';
import type { StateManager } from '../state-manager.js';
import { tag, createDebug } from '../utils/logger.js';
import { setActivity } from '../activity.ts';
import type { WebPageState } from '../state-manager.js';
import { type Conversation, Message } from './conversation.js';
import type { ExperienceTracker } from '../experience-tracker.ts';
import { z } from 'zod';
import dedent from 'dedent';

const debugLog = createDebug('explorbot:planner');

export interface Task {
  scenario: string;
  status: 'pending' | 'completed' | 'failed';
  conversation: Conversation;
  priority: 'high' | 'medium' | 'low';
}

const TaskSchema = z.object({
  scenario: z.string().describe('A single sentence describing what to test'),
  priority: z
    .enum(['high', 'medium', 'low'])
    .describe('Priority of the task based on importance and risk'),
});

const CreateTasksSchema = z.object({
  tasks: z
    .array(TaskSchema)
    .describe('Array of testing scenarios with priorities'),
});

const createTasksTool = {
  description: 'Create testing tasks with priorities for the current page',
  parameters: CreateTasksSchema,
  execute: async (params: {
    tasks: Array<{ scenario: string; priority: 'high' | 'medium' | 'low' }>;
  }) => {
    return {
      success: true,
      message: `Created ${params.tasks.length} tasks with priorities`,
      tasks: params.tasks,
    };
  },
};

export class Planner {
  private provider: Provider;
  private stateManager: StateManager;
  private experienceTracker: ExperienceTracker;

  constructor(provider: Provider, stateManager: StateManager) {
    this.provider = provider;
    this.stateManager = stateManager;
    this.experienceTracker = stateManager.getExperienceTracker();
  }

  async plan(conversation: Conversation): Promise<Task[]> {
    const state = this.stateManager.getCurrentState();
    debugLog('Planning:', state?.url);
    if (!state) throw new Error('No state found');

    const prompt = this.buildPlanningPrompt(state);

    setActivity('👨‍💻 Planning...', 'action');

    conversation.addUserText(prompt);

    debugLog('Sending planning prompt to AI provider with tool calling');

    const tools = {
      createTasks: createTasksTool,
    };

    const result = await this.provider.generateWithTools(
      conversation.messages,
      tools,
      {
        toolChoice: 'required',
      }
    );

    if (!result || !result.toolResults || result.toolResults.length === 0) {
      throw new Error('Failed to get planning response - no tool calls made');
    }

    const toolResult = result.toolResults[0];
    if (toolResult.toolName !== 'createTasks' || !toolResult.result?.success) {
      throw new Error('Expected createTasks tool to be called successfully');
    }

    const tasks = toolResult.result.tasks.map(
      (taskData: {
        scenario: string;
        priority: 'high' | 'medium' | 'low';
      }) => ({
        scenario: taskData.scenario,
        status: 'pending' as const,
        priority: taskData.priority,
        conversation: conversation.clone(),
      })
    );

    debugLog('Created tasks:', tasks);

    const priorityOrder = { high: 0, medium: 1, low: 2 };
    const sortedTasks = [...tasks].sort(
      (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]
    );

    tag('info').log('📋 Testing Plan');
    sortedTasks.forEach((task: Task) => {
      const priorityIcon =
        task.priority === 'high'
          ? '🔴'
          : task.priority === 'medium'
            ? '🟡'
            : '🟢';
      tag('info').log(`${priorityIcon} ${task.scenario}`);
    });

    return sortedTasks;
  }

  private buildPlanningPrompt(state: WebPageState): string {
    return dedent`Based on the previous research, create 3-7 exploratory testing scenarios for this page using the createTasks tool.

      You MUST use the createTasks tool to provide your response.

      When creating tasks:
      1. Assign priorities based on:
         - HIGH: Critical functionality, user flows, security-related, or high-risk features
         - MEDIUM: Important features that affect user experience but aren't critical
         - LOW: Edge cases, minor features, or nice-to-have validations
      2. Start with positive scenarios and then move to negative scenarios
      3. Focus on main content of the page, not in the menu, sidebar or footer
      4. Provide a good mix of high, medium, and low priority tasks

      <rules>
      Suggest tests only which you can handle. 
      Your only tool is web browser driven via Playwright.
      You can suggest testing only through web interface.
      You can't test emails, database, SMS, or any external services.
      Do not propose tests you can't check.
      Suggest tests that can be potentially verified by UI.
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
}
