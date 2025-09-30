import dedent from 'dedent';
import { z } from 'zod';
import { ActionResult } from '../action-result.ts';
import { setActivity } from '../activity.ts';
import type Explorer from '../explorer.ts';
import type { ExperienceTracker } from '../experience-tracker.ts';
import type { StateManager } from '../state-manager.js';
import { createDebug, tag } from '../utils/logger.js';
import type { Agent } from './agent.js';
import { Conversation } from './conversation.ts';
import type { Provider } from './provider.js';
import { Researcher } from './researcher.ts';

const debugLog = createDebug('explorbot:planner');

export interface Task {
  scenario: string;
  status: 'pending' | 'in_progress' | 'success' | 'failed';
  priority: 'high' | 'medium' | 'low' | 'unknown';
  expectedOutcome: string;
  logs: string[];
}

const TasksSchema = z.object({
  scenarios: z
    .array(
      z.object({
        scenario: z.string().describe('A single sentence describing what to test'),
        priority: z.enum(['high', 'medium', 'low', 'unknown']).describe('Priority of the task based on importance and risk'),
        expectedOutcome: z.string().describe('Expected result or behavior after executing the task'),
      })
    )
    .describe('List of testing scenarios'),
  reasoning: z.string().optional().describe('Brief explanation of the scenario selection'),
});

export class Planner implements Agent {
  emoji = '📋';
  private explorer: Explorer;
  private provider: Provider;
  private stateManager: StateManager;
  private experienceTracker: ExperienceTracker;

  MIN_TASKS = 3;
  MAX_TASKS = 7;

  constructor(explorer: Explorer, provider: Provider) {
    this.explorer = explorer;
    this.provider = provider;
    this.stateManager = explorer.getStateManager();
    this.experienceTracker = this.stateManager.getExperienceTracker();
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

    const actionResult = ActionResult.fromState(state);
    const conversation = await this.buildConversation(actionResult);

    tag('info').log(`Initiated planning for ${state.url} to create testing scenarios...`);
    setActivity('👨‍💻 Planning...', 'action');

    debugLog('Sending planning prompt to AI provider with structured output');

    const result = await this.provider.generateObject(conversation.messages, TasksSchema);

    if (!result?.object?.scenarios || result.object.scenarios.length === 0) {
      throw new Error('No tasks were created successfully');
    }

    const tasks: Task[] = result.object.scenarios.map((s: any) => ({
      scenario: s.scenario,
      status: 'pending' as const,
      priority: s.priority,
      expectedOutcome: s.expectedOutcome,
      logs: [],
    }));

    debugLog('Created tasks:', tasks);

    const priorityOrder = { high: 0, medium: 1, low: 2, unknown: 3 };
    const sortedTasks = [...tasks].sort(
      (a, b) => (priorityOrder[a.priority.toLowerCase() as keyof typeof priorityOrder] || 0) - (priorityOrder[b.priority.toLowerCase() as keyof typeof priorityOrder] || 0)
    );

    const summary = result.object.reasoning
      ? `${result.object.reasoning}\n\nScenarios:\n${tasks.map((t) => `- ${t.scenario}`).join('\n')}`
      : `Scenarios:\n${tasks.map((t) => `- ${t.scenario}`).join('\n')}`;

    this.experienceTracker.writeExperienceFile(`plan_${actionResult.getStateHash()}`, summary, {
      url: actionResult.relativeUrl,
    });

    tag('multiline').log(summary);

    return sortedTasks;
  }

  private async buildConversation(state: ActionResult): Promise<Conversation> {
    const conversation = new Conversation();

    conversation.addUserText(this.getSystemMessage());

    const planningPrompt = dedent`Based on the previous research, create ${this.MIN_TASKS}-${this.MAX_TASKS} exploratory testing scenarios for this page.

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
      Focus on main content of the page, not in the menu, sidebar or footer
      Start with positive scenarios and then move to negative scenarios
      </rules>

      <context>
      URL: ${state.url || 'Unknown'}
      Title: ${state.title || 'Unknown'}

      Web Page Content:
      ${await state.textHtml()}
      </context>
    `;

    conversation.addUserText(planningPrompt);

    const currentState = this.stateManager.getCurrentState();
    if (!currentState) throw new Error('No state found');

    if (!currentState.researchResult) {
      const research = await new Researcher(this.explorer, this.provider).research();
      conversation.addUserText(`Identified page elements: ${research}`);
    } else {
      conversation.addUserText(`Identified page elements: ${currentState.researchResult}`);
    }

    const tasksMessage = dedent`
    <task>
      Provide testing scenarios as structured data with the following requirements:
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
      7. At least ${this.MIN_TASKS} tasks should be proposed.
    </task>
    `;

    conversation.addUserText(tasksMessage);

    return conversation;
  }
}
