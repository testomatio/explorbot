import dedent from 'dedent';
import { z } from 'zod';
import { ActionResult } from '../action-result.ts';
import { setActivity } from '../activity.ts';
import type Explorer from '../explorer.ts';
import type { StateManager } from '../state-manager.js';
import { Plan, Test } from '../test-plan.ts';
import { createDebug, tag } from '../utils/logger.js';
import type { Agent } from './agent.js';
import { Conversation } from './conversation.ts';
import type { Provider } from './provider.js';
import { Researcher } from './researcher.ts';
import { protectionRule } from './rules.ts';

const debugLog = createDebug('explorbot:planner');

const TasksSchema = z.object({
  scenarios: z
    .array(
      z.object({
        scenario: z.string().describe('A single sentence describing what to test'),
        priority: z.enum(['high', 'medium', 'low', 'unknown']).describe('Priority of the task based on importance and risk'),
        expectedOutcomes: z
          .array(z.string())
          .describe(
            'List of expected outcomes that can be verified. Each outcome should be simple, specific, and easy to check (e.g., "Success message appears", "URL changes to /dashboard", "Form field shows error"). Keep outcomes atomic - do not combine multiple checks into one.'
          ),
      })
    )
    .describe('List of testing scenarios'),
  reasoning: z.string().optional().describe('Brief explanation of the scenario selection'),
});

let planId = 0;
export class Planner implements Agent {
  emoji = '📋';
  private explorer: Explorer;
  private provider: Provider;
  private stateManager: StateManager;

  MIN_TASKS = 3;
  MAX_TASKS = 7;
  previousPlan: Plan | null = null;
  researcher: Researcher;

  constructor(explorer: Explorer, provider: Provider) {
    this.explorer = explorer;
    this.provider = provider;
    this.researcher = new Researcher(explorer, provider);
    this.stateManager = explorer.getStateManager();
  }

  getSystemMessage(): string {
    return dedent`
    <role>
    You are ISTQB certified senior manual QA planning exploratory testing session of a web application.
    </role>
    <task>
      List possible testing scenarios for the web page.
      Focus on main content of the page, not in the menu, sidebar or footer
      Start with positive scenarios and then move to negative scenarios
      Tests must be atomic and independent of each other
      Tests must be relevant to the page
      Tests must be achievable from UI
      Tests must be verifiable from UI
      Tests must be independent of each other
    </task>
    `;
  }

  setPreviousPlan(plan: Plan): void {
    this.previousPlan = plan;
  }

  async plan(feature?: string): Promise<Plan> {
    const state = this.stateManager.getCurrentState();
    debugLog('Planning:', state?.url);
    if (!state) throw new Error('No state found');

    const actionResult = ActionResult.fromState(state);
    const conversation = await this.buildConversation(actionResult);

    setActivity(`${this.emoji} Planning...`, 'action');
    tag('info').log(`Planning test scenarios for ${state.url}...`);
    if (feature) {
      tag('step').log(`Focusing on ${feature}`);
      conversation.addUserText(feature);
    } else {
      tag('step').log('Focusing on main content of this page');
    }

    debugLog('Sending planning prompt to AI provider with structured output');

    const result = await this.provider.generateObject(conversation.messages, TasksSchema);

    if (!result?.object?.scenarios || result.object.scenarios.length === 0) {
      throw new Error('No tasks were created successfully');
    }

    const tasks: Test[] = result.object.scenarios.map((s: any) => new Test(s.scenario, s.priority, s.expectedOutcomes));

    tasks.forEach((t) => {
      t.startUrl = state.url;
    });

    debugLog('Created tasks:', tasks);

    const priorityOrder = { high: 0, medium: 1, low: 2, unknown: 3 };
    const sortedTasks = [...tasks].sort(
      (a, b) => (priorityOrder[a.priority.toLowerCase() as keyof typeof priorityOrder] || 0) - (priorityOrder[b.priority.toLowerCase() as keyof typeof priorityOrder] || 0)
    );

    const summary = result.object.reasoning
      ? `${result.object.reasoning}\n\nScenarios:\n${tasks.map((t) => `- ${t.scenario}`).join('\n')}`
      : `Scenarios:\n${tasks.map((t) => `- ${t.scenario}`).join('\n')}`;

    tag('multiline').log(summary);
    tag('success').log(`Planning compelete! ${tasks.length} tests proposed`);

    const plan = new Plan(state?.url || `Plan ${planId++}`, sortedTasks);
    plan.initialState(state!);
    return plan;
  }

  private async buildConversation(state: ActionResult): Promise<Conversation> {
    const conversation = new Conversation();

    conversation.addUserText(this.getSystemMessage());

    const planningPrompt = dedent`
      <task>
      Based on the previous research, create ${this.MIN_TASKS}-${this.MAX_TASKS} exploratory testing scenarios for this page.

      When creating tasks:
      1. Assign priorities based on:
         - HIGH: Critical functionality, user flows, security-related, or high-risk features
         - MEDIUM: Important features that affect user experience but aren't critical
         - LOW: Edge cases, minor features, or nice-to-have validations
      2. Start with positive scenarios and then move to negative scenarios
      3. For each task, provide multiple specific expected outcomes that can be verified:
         - Keep each outcome simple and atomic (one check per outcome)
         - Examples: "Success message is displayed", "URL changes to /dashboard", "Submit button is disabled"
         - Avoid combining multiple checks: Instead of "Form submits and shows success", use two outcomes: "Form is submitted", "Success message appears"
      </task>

      <rules>
      Scenarios must involve interaction with the web page (clicking, scrolling or typing).
      Scenarios must focus on business logic and functionality of the page.
      Focus on main content of the page, not in the menu, sidebar or footer
      Propose business scenarios first, then technical scenarios.
      You can suggest scenarios that can be tested only through web interface.
      You can't test emails, database, SMS, or any external services.
      Suggest scenarios that can be potentially verified by UI.
      Focus on error or success messages as outcome.
      Focus on URL page change or data persistency after page reload.
      If there are subpages (pages with same URL path) plan testing of those subpages as well
      If you plan to test CRUD operations, plan them in correct order: create, read, update.
      Use equivalency classes when planning test scenarios.
      ${protectionRule}
      </rules>

      <approach>
      Plan happy path scenarios first to accomplish business goals page allows to achieve.
      If page has form => provide scenarios to test form input (empty/digits/html chars/html/special characters/injections/etc)
      If page has filters => check all filters combinations
      If page has sorting => check all sorting combinations
      If page has pagination => try navigating to different pages
      If page has search => try searching for different values and see that only relevant results are shown
      </approach>

      <context>
      URL: ${state.url || 'Unknown'}
      Title: ${state.title || 'Unknown'}

      Web Page Content:
      ${await state.textHtml()}
      </context>
    `;

    conversation.addUserText(planningPrompt);
    const research = await this.researcher.research(state);
    conversation.addUserText(`Identified page elements: ${research}`);

    if (this.previousPlan) {
      conversation.addUserText(dedent`
        We already launched following tests.
        Focus on new scenarios, not on already tested ones.
        Think how can you expand testing and check more scenario based on knowledge from previous tests.
        What else can be potentially tested based on HTML context and from previous tests?
        If you created item, check if you can interact with it.
        If you created item check if you can edit it.
        It is ALLOWED TO DELETE item you previously created.

        <tests>
        ${this.previousPlan.toAiContext()}
        </tests>

        Plan your next tests analyzing the pages we visited during previous testing session:

        <pages>
        ${this.previousPlan
          .getVisitedPages()
          .map(
            (s) => `
          <page>${ActionResult.fromState(s).toAiContext()}
          <page_content>
          ${Researcher.getCachedResearch(s) || this.researcher.textContent(s)}
          </page_content>
          </page>`
          )
          .join('\n')}
        </pages>

        Consider purpose of visited pages when planning new tests.
        `);
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
      4. Focus on tests you are 100% sure relevant to this page and can be achived from UI.
      5. For each task, provide multiple specific expected outcomes as an array:
         - Keep each outcome simple and atomic (one verification per outcome)
         - Good examples: "Success message is displayed", "URL changes to /dashboard", "Submit button becomes disabled"
         - Bad example: "Form submits successfully and shows confirmation with updated data" (too many checks in one)
         - Each outcome should be independently verifiable
         - Avoid combining multiple checks into one outcome
         - Do not add extra prefixes like: TITLE:, TEST:, Scenario: etc. 
         - Do not wrap text in ** or * quotes, ( or ) brackets.
         - Avoid using emojis or special characters.
      6. Only tests that can be tested from web UI should be proposed.
      7. At least ${this.MIN_TASKS} tests should be proposed.
    </task>
    `;

    conversation.addUserText(tasksMessage);

    conversation.autoTrimTag('page_content', 5000);
    return conversation;
  }
}
