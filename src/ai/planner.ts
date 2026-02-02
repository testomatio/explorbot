import dedent from 'dedent';
import { z } from 'zod';
import { ActionResult } from '../action-result.ts';
import { setActivity } from '../activity.ts';
import type Explorer from '../explorer.ts';
import { Observability } from '../observability.ts';
import type { StateManager } from '../state-manager.js';
import { Plan, Test } from '../test-plan.ts';
import { collectInteractiveNodes } from '../utils/aria.ts';
import { createDebug, tag } from '../utils/logger.js';
import type { Agent } from './agent.js';
import { Conversation } from './conversation.ts';
import type { Provider } from './provider.js';
import { Researcher } from './researcher.ts';
import { protectionRule } from './rules.ts';

const debugLog = createDebug('explorbot:planner');

const TasksSchema = z.object({
  planName: z.string().describe('Short descriptive name for the test plan (e.g., "User Authentication Testing", "Product Catalog Navigation", "Form Validation Tests")'),
  scenarios: z
    .array(
      z.object({
        scenario: z.string().describe('A single sentence describing what to test'),
        priority: z.enum(['high', 'medium', 'low', 'unknown']).describe('Priority of the task based on importance and risk'),
        steps: z.array(z.string()).describe('List of steps to perform for this scenario. Each step should be a specific action (e.g., "Click on Login button", "Enter username in email field", "Submit the form"). Keep steps atomic and actionable.'),
        expectedOutcomes: z
          .array(z.string())
          .describe('List of expected outcomes that can be verified. Each outcome should be simple, specific, and easy to check (e.g., "Success message appears", "URL changes to /dashboard", "Form field shows error"). Keep outcomes atomic - do not combine multiple checks into one.'),
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
  private analyzedUrls: Set<string> = new Set();

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
      For each scenario provide:
      - Steps: specific actions to perform (e.g., "Click Login button", "Enter email address")
      - Expected outcomes: observable results to verify (e.g., "Success message appears", "URL changes to /dashboard")

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

  async discoverTestsFromVisitedStates(plan: Plan): Promise<Test[]> {
    const visitedStates = plan.getVisitedPages();
    const unanalyzedStates = visitedStates.filter((state) => !this.analyzedUrls.has(state.url));
    if (unanalyzedStates.length === 0) return [];

    for (const state of unanalyzedStates) {
      this.analyzedUrls.add(state.url);
    }

    const statesContext = unanalyzedStates
      .map((state) => {
        const ariaSnapshot = state.ariaSnapshot || '';
        const interactiveNodes = collectInteractiveNodes(ariaSnapshot);

        const interactiveRoles = new Set(['button', 'link', 'combobox', 'listbox', 'menuitem', 'tab']);
        const elements = interactiveNodes
          .filter((node) => interactiveRoles.has(node.role as string))
          .filter((node) => node.name && (node.name as string).length > 2)
          .map((node) => `${node.role}: "${node.name}"`)
          .slice(0, 20);

        const uiContext = this.detectUIContext(ariaSnapshot);

        return { url: state.url, uiContext, elements };
      })
      .filter((s) => s.elements.length > 0);

    if (statesContext.length === 0) return [];

    const currentTests = plan.tests.map((t) => t.scenario).join('\n');

    const schema = z.object({
      tests: z
        .array(
          z.object({
            scenario: z.string().describe('Short test scenario name'),
            firstStep: z.string().describe('First step: which element on which page, e.g. "Click Resend Invite button on /users page"'),
            triggerUrl: z.string().describe('URL where the trigger element was found'),
          })
        )
        .max(5)
        .describe('Up to 5 new happy-path test scenarios'),
    });

    const result = await this.provider.generateObject(
      [
        {
          role: 'user',
          content: dedent`
            Plan: ${plan.title}
            Current tests:
            ${currentTests}

            Pages visited during testing:
            ${statesContext
              .map(
                (s) => dedent`
              URL: ${s.url}${s.uiContext ? ` (${s.uiContext})` : ''}
              Elements: ${s.elements.join(', ')}
            `
              )
              .join('\n\n')}

            Identify NEW happy-path test scenarios from these elements.
            Only suggest tests NOT covered by current tests.
            Each test must include a first step stating which element on which page.
            Return empty array if no new scenarios needed.
            Maximum 5 tests. Only positive scenarios.
          `,
        },
      ],
      schema,
      this.provider.getModelForAgent('planner')
    );

    const suggestions = result?.object?.tests || [];
    const newTests: Test[] = [];

    for (const suggestion of suggestions) {
      const test = new Test(suggestion.scenario, 'low', [], suggestion.triggerUrl, [suggestion.firstStep]);
      newTests.push(test);
    }

    if (newTests.length > 0) {
      debugLog(`Discovered ${newTests.length} new test paths from visited states`);
    }

    return newTests;
  }

  private detectUIContext(ariaSnapshot: string): string | null {
    if (!ariaSnapshot) return null;
    if (ariaSnapshot.includes('dialog') || ariaSnapshot.includes('modal')) return 'modal open';
    if (ariaSnapshot.includes('tabpanel')) return 'tab panel active';
    if (ariaSnapshot.includes('menu[expanded=true]')) return 'menu expanded';
    return null;
  }

  async plan(feature?: string): Promise<Plan> {
    return Observability.run(
      'planner.plan',
      {
        tags: ['planner'],
      },
      async () => {
        const state = this.stateManager.getCurrentState();
        debugLog('Planning:', state?.url);
        if (!state) throw new Error('No state found');

        let discoveredTests: Test[] = [];
        if (this.previousPlan) {
          const executedTests = this.previousPlan.tests.filter((t) => t.result !== null);
          if (executedTests.length > 0) {
            discoveredTests = await this.discoverTestsFromVisitedStates(this.previousPlan);
          }
        }

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

        const result = await this.provider.generateObject(conversation.messages, TasksSchema, conversation.model);

        if (!result?.object?.scenarios || result.object.scenarios.length === 0) {
          throw new Error('No tasks were created successfully');
        }

        const tests: Test[] = result.object.scenarios.map((s: any) => new Test(s.scenario, s.priority, s.expectedOutcomes, state.url, s.steps || []));

        debugLog('Created tests:', tests);

        const planName = result.object.planName || `Plan ${planId++}`;
        const summary = result.object.reasoning ? `${result.object.reasoning}\n\nScenarios:\n${tests.map((t) => `- ${t.scenario}`).join('\n')}` : `Scenarios:\n${tests.map((t) => `- ${t.scenario}`).join('\n')}`;

        tag('multiline').log(summary);
        tag('success').log(`Planning complete! ${tests.length} tests proposed for: ${planName}`);

        const plan = new Plan(planName);
        tests.forEach((t) => {
          t.startUrl = state.url;
          plan.addTest(t);
        });

        for (const test of discoveredTests) {
          test.startUrl = test.startUrl || state.url;
          test.plan = plan;
          plan.addTest(test);
        }

        if (discoveredTests.length > 0) {
          tag('step').log(`Added ${discoveredTests.length} discovered test scenarios`);
        }

        return plan;
      }
    );
  }

  private async buildConversation(state: ActionResult): Promise<Conversation> {
    const model = this.provider.getModelForAgent('planner');
    const conversation = new Conversation([], model);

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
      3. For each task, provide BOTH steps and expected outcomes:
         - Steps: specific actions to perform (e.g., "Click Login button", "Enter username in email field", "Submit the form")
         - Expected outcomes: observable results to verify (e.g., "Success message is displayed", "URL changes to /dashboard", "Submit button is disabled")
         - Keep each outcome simple and atomic (one check per outcome)
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
    const research = await this.researcher.research(state, { deep: true });
    conversation.addUserText(`Identified page elements: ${research}`);

    if (this.previousPlan) {
      tag('step').log('Looking at previous plan to expand testing');

      const passed = this.previousPlan.tests.filter((t) => t.result === 'passed');
      const failed = this.previousPlan.tests.filter((t) => t.result === 'failed');
      const pending = this.previousPlan.tests.filter((t) => !t.result);

      const summaryParts: string[] = [];
      if (passed.length > 0) summaryParts.push(`${passed.length} passed`);
      if (failed.length > 0) summaryParts.push(`${failed.length} failed`);
      if (pending.length > 0) summaryParts.push(`${pending.length} pending`);
      const summary = summaryParts.join(', ');

      conversation.addUserText(dedent`
        We already executed tests for this URL (${summary}).

        <previous_test_results>
        ${this.previousPlan.toAiContext()}
        </previous_test_results>

        <planning_strategy>
        Based on previous test execution:

        1. FOR PASSED TESTS - Add negative/edge case scenarios:
           - Boundary value testing (min/max values, empty inputs)
           - Invalid input testing (wrong formats, special characters)
           - Error condition testing (network errors, validation failures)
           - Extend to deeper levels of the same feature

        2. FOR FAILED TESTS - Skip those paths entirely:
           - Do NOT repeat failed scenarios
           - Find NEW alternative paths to test similar functionality
           - Look for unexplored areas of the page

        3. EXPAND COVERAGE:
           - If items were created, test editing/deleting them
           - Explore pages that were visited but not deeply tested
           - Look at elements discovered during testing that weren't interacted with
        </planning_strategy>

        <context_from_previous_tests>
        Pages visited during testing (with discovered elements):
        ${this.previousPlan
          .getVisitedPages()
          .map(
            (s) => dedent`
            <page url="${s.url}">
            ${ActionResult.fromState(s).toAiContext()}
            <research>
            ${Researcher.getCachedResearch(s) || this.researcher.textContent(s)}
            </research>
            </page>`
          )
          .join('\n')}
        </context_from_previous_tests>

        Use the context above to understand what was achieved and what new scenarios can be tested.
        `);
    }

    const tasksMessage = dedent`
    <task>
      Provide testing scenarios as structured data with the following requirements:
      1. Create a short, descriptive plan name that summarizes what will be tested (e.g., "User Authentication Testing", "Product Catalog Navigation", "Form Validation Tests")
      2. Assign priorities based on:
         - HIGH: Critical functionality, user flows, security-related, or high-risk features
         - MEDIUM: Important features that affect user experience but aren't critical
         - LOW: Edge cases, minor features, or nice-to-have validations.
         If you are unsure about the priority, set it to LOW.
      3. Start with positive scenarios and then move to negative scenarios
      4. Focus on main content of the page, not in the menu, sidebar or footer
      5. Focus on tests you are 100% sure relevant to this page and can be achived from UI.
      6. For each task, provide BOTH steps and expected outcomes as separate arrays:

         STEPS - actionable commands:
         - Each step should be a specific action to perform
         - Good examples: "Click on Login button", "Enter username in email field", "Submit the form"
         - Bad example: "Login and verify dashboard" (too vague and combines action with verification)
         - Steps describe WHAT TO DO

         EXPECTED OUTCOMES - verifiable results:
         - Keep each outcome simple and atomic (one verification per outcome)
         - Good examples: "Success message is displayed", "URL changes to /dashboard", "Submit button becomes disabled"
         - Bad example: "Form submits successfully and shows confirmation with updated data" (too many checks in one)
         - Each outcome should be independently verifiable
         - Avoid combining multiple checks into one outcome
         - Expected outcomes describe WHAT TO VERIFY

         FORMATTING RULES:
         - Do not add extra prefixes like: TITLE:, TEST:, Scenario:, Step:, Expected: etc.
         - Do not wrap text in ** or * quotes, ( or ) brackets.
         - Avoid using emojis or special characters.
      7. Only tests that can be tested from web UI should be proposed.
      8. At least ${this.MIN_TASKS} tests should be proposed.
    </task>
    `;

    conversation.addUserText(tasksMessage);

    conversation.autoTrimTag('page_content', 5000);
    return conversation;
  }
}
