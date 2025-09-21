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
}

const PlanningSchema = z.object({
  tasks: z
    .array(
      z.object({
        scenario: z
          .string()
          .describe('A single sentence describing what to test'),
      })
    )
    .describe('Array of testing scenarios'),
});

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

    debugLog('Sending planning prompt to AI provider with structured output');

    const result = await this.provider.generateObject(
      conversation.messages,
      PlanningSchema
    );
    if (!result) throw new Error('Failed to get planning response');

    const planningData = result.object;
    debugLog('Planning response:', planningData);

    const tasks = planningData.tasks.map((taskData: { scenario: string }) => ({
      scenario: taskData.scenario,
      status: 'pending' as const,
      conversation: conversation.clone(),
    }));

    tag('info').log('📋 Testing Plan');
    tasks.forEach((task: Task) => {
      tag('info').log('☐', task.scenario);
    });

    return tasks;
  }

  private buildPlanningPrompt(state: WebPageState): string {
    return dedent`Based on the previous research, suggest 3-7 exploratory testing scenarios to test on this page.

      Start with positive scenarios and then move to negative scenarios.
      Focus on main content of the page, not in the menu, sidebar or footer.

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
