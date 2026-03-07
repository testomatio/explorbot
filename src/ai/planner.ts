import dedent from 'dedent';
import { z } from 'zod';
import { ActionResult } from '../action-result.ts';
import { setActivity } from '../activity.ts';
import { ConfigParser } from '../config.ts';
import { ExperienceTracker } from '../experience-tracker.ts';
import type Explorer from '../explorer.ts';
import { Observability } from '../observability.ts';
import type { StateManager } from '../state-manager.js';
import { Stats } from '../stats.ts';
import { Plan, Test } from '../test-plan.ts';
import { createDebug, tag } from '../utils/logger.js';
import { mdq } from '../utils/markdown-query.js';
import type { Agent } from './agent.js';
import { Conversation } from './conversation.ts';
import type { Provider } from './provider.js';
import { POSSIBLE_SECTIONS, Researcher } from './researcher.ts';
import { fileUploadRule, protectionRule } from './rules.ts';

const debugLog = createDebug('explorbot:planner');

const planCache: Map<string, Plan> = new Map();

const TasksSchema = z.object({
  planName: z.string().describe('Short descriptive name for the test plan (e.g., "User Authentication Testing", "Product Catalog Navigation", "Form Validation Tests")'),
  scenarios: z
    .array(
      z.object({
        scenario: z.string().describe('A single sentence describing what to test'),
        priority: z.enum(['critical', 'important', 'high', 'normal', 'low']).describe('Priority of the task based on business importance'),
        steps: z.array(z.string()).describe('List of steps to perform for this scenario. Each step should be a specific action (e.g., "Click on Login button", "Enter username in email field", "Submit the form"). Keep steps atomic and actionable.'),
        expectedOutcomes: z
          .array(z.string())
          .describe('List of expected outcomes that can be verified. Each outcome should be simple, specific, and easy to check (e.g., "Success message appears", "URL changes to /dashboard", "Form field shows error"). Keep outcomes atomic - do not combine multiple checks into one.'),
      })
    )
    .describe('List of testing scenarios'),
});

export class Planner implements Agent {
  emoji = '📋';
  private explorer: Explorer;
  private provider: Provider;
  private stateManager: StateManager;
  private experienceTracker: ExperienceTracker;

  MIN_TASKS = 3;
  MAX_TASKS = 12;
  currentPlan: Plan | null = null;
  researcher: Researcher;
  private analyzedUrls: Set<string> = new Set();

  constructor(explorer: Explorer, provider: Provider) {
    this.explorer = explorer;
    this.provider = provider;
    this.researcher = new Researcher(explorer, provider);
    this.stateManager = explorer.getStateManager();
    this.experienceTracker = new ExperienceTracker();
  }

  private get sectionOrder(): string[] {
    return ConfigParser.getInstance().getConfig().ai?.agents?.researcher?.sections || Object.keys(POSSIBLE_SECTIONS);
  }

  getSystemMessage(): string {
    const customPrompt = this.provider.getSystemPromptForAgent('planner');
    return dedent`
    <role>
    You are ISTQB certified senior manual QA planning exploratory testing session of a web application.
    Each test scenario must complete a meaningful user workflow — not just open a UI element and verify it exists.
    Bad: "Open the Help panel" — just opens something.
    Good: "Create a new suite and verify it appears in the list" — completes a business action.
    </role>
    <task>
      List possible testing scenarios for the web page.
      For each scenario provide:
      - Steps: specific actions forming a complete workflow
      - Expected outcomes: observable business results to verify

      Focus on completing meaningful actions, not just verifying UI elements exist.
      Start with positive scenarios and then move to negative scenarios
      Tests must be atomic and independent of each other
      Tests must be relevant to the page
      Tests must be achievable from UI
      Tests must be verifiable from UI
      Tests must be independent of each other
    </task>

    ${customPrompt || ''}
    `;
  }

  setPlan(plan: Plan): void {
    this.currentPlan = plan;
  }

  static getCachedPlan(url: string): Plan | null {
    const baseUrl = url.split('?')[0].split('#')[0];
    return planCache.get(baseUrl) || null;
  }

  static cachePlan(url: string, plan: Plan): void {
    const baseUrl = url.split('?')[0].split('#')[0];
    planCache.set(baseUrl, plan);
  }

  async plan(feature?: string): Promise<Plan> {
    Stats.plans++;
    const state = this.stateManager.getCurrentState();
    debugLog('Planning:', state?.url);
    if (!state) throw new Error('No state found');

    if (!this.currentPlan && state.url) {
      this.currentPlan = Planner.getCachedPlan(state.url);
      if (this.currentPlan) {
        tag('step').log(`Loaded cached plan: "${this.currentPlan.title}"`);
      }
    }

    setActivity(`${this.emoji} Planning...`, 'action');
    tag('info').log(`Planning test scenarios for ${state.url}...`);

    const result = await Observability.run(`planner: ${state.url}`, { tags: ['planner'], sessionId: state.url }, async () => {
      const allTests: Test[] = [];

      if (this.currentPlan) {
        const executedTests = this.currentPlan.tests.filter((t) => t.result !== null);
        if (executedTests.length > 0) {
          tag('step').log(`Found ${executedTests.length} executed tests, looking for new scenarios...`);
          const fromVisited = await this.discoverTestsFromVisitedStates();
          allTests.push(...fromVisited);
        } else {
          tag('substep').log('No tests have been executed yet, skipping path discovery');
        }
      }

      const actionResult = ActionResult.fromState(state);
      const conversation = await this.buildConversation(actionResult);

      if (feature) {
        tag('step').log(`Focusing on ${feature}`);
        conversation.addUserText(feature);
      } else {
        tag('step').log('Focusing on main content of this page');
      }

      debugLog('Sending planning prompt to AI provider with structured output');

      const aiResult = await this.provider.generateObject(conversation.messages, TasksSchema, conversation.model);

      if (!aiResult?.object?.scenarios) {
        throw new Error('No tasks were created successfully');
      }

      if (aiResult.object.scenarios.length === 0 && !this.currentPlan && allTests.length === 0) {
        throw new Error('No tasks were created successfully');
      }

      const fromPlanning = aiResult.object.scenarios.map((s: any) => new Test(s.scenario, s.priority, s.expectedOutcomes, state.url, s.steps || []));
      allTests.push(...fromPlanning);

      return { tests: allTests, planName: aiResult.object.planName };
    });

    const tests = result.tests;
    debugLog('Created tests:', tests);

    if (!this.currentPlan) {
      const planName = result.planName || state.url;
      this.currentPlan = new Plan(planName);
      this.currentPlan.url = state.url;
      for (const t of tests) {
        t.startUrl = state.url;
        this.currentPlan.addTest(t);
      }
      const summary = `Scenarios:\n${this.currentPlan.tests.map((t) => `- [${t.priority}] ${t.scenario}`).join('\n')}`;
      tag('multiline').log(summary);
    } else {
      tag('step').log(`Expanding plan: "${this.currentPlan.title}"`);
      this.currentPlan.nextIteration();
      const newTests = this.addNewTests(tests, state.url);
      if (newTests.length > 0) {
        const summary = `New scenarios:\n${newTests.map((t) => `+ [${t.priority}] ${t.scenario}`).join('\n')}`;
        tag('multiline').log(summary);
      }
    }

    this.moveExecutedTestsToEnd();
    tag('success').log(`Planning complete! ${this.currentPlan.tests.length} tests in plan: ${this.currentPlan.title}`);

    Planner.cachePlan(state.url, this.currentPlan);

    return this.currentPlan;
  }

  protected async discoverTestsFromVisitedStates(): Promise<Test[]> {
    if (!this.currentPlan) throw new Error('No plan set for discovery');

    const visitedStates = this.currentPlan.getVisitedPages();
    if (visitedStates.length === 0) {
      tag('substep').log('No visited pages found from previous test execution');
      return [];
    }

    const unanalyzedStates = visitedStates.filter((state) => !this.analyzedUrls.has(state.url));
    if (unanalyzedStates.length === 0) {
      tag('substep').log('All visited pages already analyzed');
      return [];
    }

    tag('step').log(`Analyzing ${unanalyzedStates.length} visited pages for new test scenarios`);

    for (const state of unanalyzedStates) {
      this.analyzedUrls.add(state.url);
    }

    const currentTests = this.currentPlan.tests.map((t) => t.scenario).join('\n');

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

    const messages = [
      {
        role: 'user' as const,
        content: dedent`
          Plan: ${this.currentPlan.title}
          Current tests:
          ${currentTests}

          Pages visited during testing:
          ${unanalyzedStates.map((s) => `- ${s.url} (${s.title || 'untitled'})`).join('\n')}

          Identify NEW happy-path test scenarios from these pages.
          Only suggest tests NOT covered by current tests.
          Each test must include a first step stating which element on which page.
          Return empty array if no new scenarios needed.
          Maximum 5 tests. Only positive scenarios.
        `,
      },
    ];

    const result = await this.provider.generateObject(messages, schema, this.provider.getModelForAgent('planner'));

    const suggestions = result?.object?.tests || [];
    const newTests: Test[] = [];

    for (const suggestion of suggestions) {
      const test = new Test(suggestion.scenario, 'normal', [], suggestion.triggerUrl, [suggestion.firstStep]);
      newTests.push(test);
    }

    if (newTests.length > 0) {
      debugLog(`Discovered ${newTests.length} new test paths from visited states`);
    }

    return newTests;
  }

  private moveExecutedTestsToEnd(): void {
    if (!this.currentPlan) return;
    const pending = this.currentPlan.tests.filter((t) => t.result === null);
    const executed = this.currentPlan.tests.filter((t) => t.result !== null);
    this.currentPlan.tests = [...pending, ...executed];
  }

  private extractFlowsFromExperience(state: ActionResult): string[] {
    const relevantExperience = this.experienceTracker.getRelevantExperience(state);
    const flows: string[] = [];

    for (const experience of relevantExperience) {
      const sections = mdq(experience.content).query('section(~"Flow")').each();
      for (const section of sections) {
        const sectionText = section.text();
        const cleaned = mdq(sectionText).query('code').replace('');
        if (cleaned.trim()) flows.push(cleaned.trim());
      }
    }

    return flows;
  }

  private addNewTests(tests: Test[], defaultStartUrl: string): Test[] {
    if (!this.currentPlan) return [];

    const existingScenarios = new Set(this.currentPlan.tests.map((t) => t.scenario.toLowerCase()));
    const added: Test[] = [];

    for (const test of tests) {
      if (existingScenarios.has(test.scenario.toLowerCase())) continue;

      test.startUrl = test.startUrl || defaultStartUrl;
      test.plan = this.currentPlan;
      this.currentPlan.addTest(test);
      existingScenarios.add(test.scenario.toLowerCase());
      added.push(test);
    }

    return added;
  }

  private async buildConversation(state: ActionResult): Promise<Conversation> {
    const model = this.provider.getModelForAgent('planner');
    const conversation = new Conversation([], model);
    conversation.autoTrimTag('page_research', 20000);
    conversation.autoTrimTag('previous_test_results', 10000);

    conversation.addUserText(this.getSystemMessage());

    const planningPrompt = dedent`
      <task>
      Based on the page research, create ${this.MIN_TASKS}-${this.MAX_TASKS} exploratory testing scenarios.
      For each scenario provide specific steps and expected outcomes.
      </task>

      <rules>
      Scenarios must involve interaction with the web page (clicking, scrolling or typing).
      Scenarios must focus on business logic and functionality of the page.
      Focus on interactive elements of the page. Skip navigation links that lead away from current page.
      Each dropdown menu, modal, or panel discovered in Extended Research is a separate feature.
      Propose business scenarios first, then technical scenarios.
      You can suggest scenarios that can be tested only through web interface.
      You can't test emails, database, SMS, or any external services.
      Suggest scenarios that can be potentially verified by UI.
      Focus on error or success messages as outcome.
      Focus on URL page change or data persistency after page reload.
      If there are subpages (pages with same URL path) plan testing of those subpages as well
      If you plan to test CRUD operations, plan them in correct order: create, read, update.
      DO NOT propose "verification-only" tests that merely open a UI element (modal, dropdown, panel) and check it exists.
      Every test must complete a meaningful action that changes application state or produces a business outcome.
      Opening a modal is NOT a test — performing an action INSIDE the modal IS a test.
      Clicking a dropdown is NOT a test — selecting an option and verifying the result IS a test.
      ${protectionRule}
      ${fileUploadRule}
      </rules>

      ${
        !this.currentPlan
          ? dedent`<approach>
      Study the page and figure out its business purpose. What is this page FOR? What would a user come here to do?

      Based on the page type, propose tests for COMPLETE user workflows:
      - If this is a data page (lists, tables): test CRUD operations end-to-end (create item → verify in list, edit item → verify changes saved, delete item → verify removed)
      - If this is a form page: test full submission flow, not just "form appears"
      - If this has filters and search: test filtering AND verify results change, not just "filter tab clicked"
      - If this has modals/dropdowns: test the ACTION inside them, not just opening/closing them

      Each test should end with the application in a different state than it started.

      IMPORTANT: Distribute tests across DIFFERENT feature areas from the research.
      Do not propose more than 2 tests for the same feature area.
      Every Extended Research section (modal, dropdown, panel) with actionable features deserves at least one test.
      Prioritize features with business actions (export, import, create, edit, delete) over simple UI interactions.

      Skip the Menu/Navigation section — we are testing THIS page.
      </approach>`
          : dedent`<approach>
      Look at the research sections and find a feature area that has NO existing tests yet.
      Pick that ONE feature and test it thoroughly — happy paths, edge cases, error handling.

      Think like a user of this product:
      - What is the purpose of this feature?
      - What would I expect to happen when I use it?
      - What could go wrong?
      - What workflows does this feature enable?

      Look carefully at Extended Research sections — modals, dropdowns, and panels are often untested.
      Each is a separate feature area. Pick one and go deep.
      </approach>`
      }

      <context>
      URL: ${state.url || 'Unknown'}
      Title: ${state.title || 'Unknown'}
      </context>
    `;

    conversation.addUserText(planningPrompt);
    const currentState = this.stateManager.getCurrentState();
    const research = await this.researcher.research(currentState || state, { deep: true });
    conversation.addUserText(dedent`
      <page_research>
      The following research describes ALL interactive elements on the page, organized by sections.
      Each numbered section and each Extended Research subsection represents a testable feature area.
      Skip the Menu/Navigation section — we test THIS page, not navigation away from it.

      ${research}
      </page_research>
    `);

    const flows = this.extractFlowsFromExperience(state);
    if (flows.length > 0) {
      conversation.addUserText(dedent`
        <previously_tested_flows>
        These flows have been tested before on this page:

        ${flows.join('\n\n')}

        Consider:
        1. Re-testing these flows if not in current plan
        2. Proposing variations of these flows (different inputs, edge cases, negative scenarios)
        3. Avoiding exact duplicates
        </previously_tested_flows>
      `);
    }

    if (this.currentPlan) {
      tag('step').log('Analyzing current plan to expand testing');

      const passed = this.currentPlan.tests.filter((t) => t.result === 'passed');
      const failed = this.currentPlan.tests.filter((t) => t.result === 'failed');
      const pending = this.currentPlan.tests.filter((t) => !t.result);

      const summaryParts: string[] = [];
      if (passed.length > 0) summaryParts.push(`${passed.length} passed`);
      if (failed.length > 0) summaryParts.push(`${failed.length} failed`);
      if (pending.length > 0) summaryParts.push(`${pending.length} pending`);
      const summary = summaryParts.join(', ');

      const existingTests = this.currentPlan.tests.map((t) => `- "${t.scenario}" [${t.priority}] [${t.result || 'pending'}]`).join('\n');

      conversation.addUserText(dedent`
        CRITICAL: This plan already has tests (${summary}).

        <existing_tests>
        ${existingTests}
        </existing_tests>

        <absolute_rules>
        1. DO NOT re-propose tests with the same scenario name or identical steps
        2. You CAN propose tests for the same feature if they test a genuinely different operation (create vs edit vs delete)
        3. A group of identical elements counts as ONE feature — one tab test covers tabs, one suite link covers suite navigation
        4. Do NOT propose tests that only differ by input data (e.g., "Search X" and "Search Y")
        5. If no genuinely new operations or features remain, return EMPTY scenarios array
        </absolute_rules>

        <previous_test_results>
        ${this.currentPlan.toAiContext()}
        </previous_test_results>

        <planning_strategy>
        Find a feature area in the research that has NO or minimal test coverage.
        Pick that ONE feature and propose ${this.MIN_TASKS}-${this.MAX_TASKS} tests for it.
        ${mdq(research).query('section("Extended Research")').count() > 0 ? 'IMPORTANT: The research contains "Extended Research" sections with dropdowns, modals, and panels. Prioritize testing features from Extended Research that have no coverage yet.' : ''}

        Think like a real user of this product:
        - What is this feature for? What business problem does it solve?
        - What would I expect to see and be able to do?
        - What are the important workflows around this feature?
        - What could go wrong when using it?

        If ALL features across ALL research sections are covered, return empty scenarios array.
        </planning_strategy>

        <context_from_previous_tests>
        Pages visited during testing:
        ${this.currentPlan
          .getVisitedPages()
          .map((s) => `- ${s.url} (${s.title || 'untitled'})`)
          .join('\n')}
        </context_from_previous_tests>

        Propose ONLY new scenarios that are NOT in the existing tests list.
        `);
    }

    const hasCurrentPlan = !!this.currentPlan;
    const tasksMessage = dedent`
    <task>
      Provide testing scenarios as structured data with the following requirements:
      1. Create a short, descriptive plan name that summarizes what will be tested (e.g., "User Authentication Testing", "Product Catalog Navigation", "Form Validation Tests")
      2. Assign priorities based on business importance:
         - CRITICAL: Core business functionality that defines the page purpose
         - IMPORTANT: Key user flows, primary features, CRUD operations
         - HIGH: Secondary features, edge cases for critical flows
         - NORMAL: Supporting actions, settings, configuration
         - LOW: Cosmetic checks, boundary testing, minor interactions
      3. Propose tests following research section order: ${this.sectionOrder.join(', ')}
         Cover sections in this order — first propose tests for elements from earlier sections, then later ones.
         Extended Research sections come after the main sections.
      4. Focus on interactive elements of the page. Skip navigation links that lead away from current page.
      5. Focus on tests you are 100% sure relevant to this page and can be achived from UI.
      6. For each task, provide BOTH steps and expected outcomes as separate arrays:

         STEPS - actionable commands:
         - Each step should be a specific action to perform
         - Good: "Click Create Suite button", "Enter 'My New Suite' as suite name", "Click Save button"
         - Good: "Click Star icon on 'Template API Testing' suite"
         - Bad: "Open the dropdown menu" (opening is not a goal, it's a means)
         - Bad: "Verify modal appears" (verification belongs in expected outcomes, not steps)
         - Steps should form a complete workflow, not stop at opening a UI element

         EXPECTED OUTCOMES - verifiable results:
         - Good: "New suite 'My New Suite' appears in the suite list"
         - Good: "Suite appears under Starred filter tab"
         - Good: "Success message 'Suite created' is displayed"
         - Bad: "Modal is displayed" (just verifying existence, no business value)
         - Bad: "Dropdown menu is visible" (just verifying existence)
         - Each outcome should be independently verifiable
         - Avoid combining multiple checks into one outcome
         - Expected outcomes describe WHAT TO VERIFY

         FORMATTING RULES:
         - Do not add extra prefixes like: TITLE:, TEST:, Scenario:, Step:, Expected: etc.
         - Do not wrap text in ** or * quotes, ( or ) brackets.
         - Avoid using emojis or special characters.
      7. Only tests that can be tested from web UI should be proposed.
      ${hasCurrentPlan ? '8. CRITICAL: Return ONLY NEW scenarios not in the existing tests list. Return empty array if no new tests needed.' : `8. At least ${this.MIN_TASKS} tests should be proposed. Cover as many different feature areas from the research as possible — do not cluster all tests around one feature.`}
    </task>
    `;

    conversation.addUserText(tasksMessage);

    return conversation;
  }
}
