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
import { Suite } from '../suite.ts';
import { Plan, Test } from '../test-plan.ts';
import { createDebug, tag } from '../utils/logger.js';
import { jsonToTable } from '../utils/markdown-parser.ts';
import { mdq } from '../utils/markdown-query.js';
import { planToCompactAiContext } from '../utils/test-plan-markdown.ts';
import type { Agent } from './agent.js';
import { Conversation } from './conversation.ts';
import type { Fisherman } from './fisherman.ts';
import { WithSessionDedup } from './planner/session-dedup.ts';
import { getActiveStyle, getStyles } from './planner/styles.ts';
import { WithSubPages, getPlannedByStateHash, getRegisteredPlan, registerPlan } from './planner/subpages.ts';
import type { Provider } from './provider.js';
import { POSSIBLE_SECTIONS, Researcher } from './researcher.ts';
import { findSimilarStateHash } from './researcher/cache.ts';
import { hasFocusedSection } from './researcher/focus.ts';
import { fileUploadRule, protectionRule } from './rules.ts';

const debugLog = createDebug('explorbot:planner');

const TasksSchema = z.object({
  planName: z.string().describe('Short descriptive name for the test plan (e.g., "User Authentication Testing", "Product Catalog Navigation", "Form Validation Tests")'),
  scenarios: z
    .array(
      z.object({
        scenario: z.string().describe('A single sentence describing what to test'),
        priority: z.enum(['critical', 'important', 'high', 'normal', 'low']).describe('Priority of the task based on business importance'),
        startUrl: z.string().nullable().describe('Start URL for the test if different from plan URL (only for tests on visited subpages)'),
        steps: z.array(z.string()).describe('List of steps to perform for this scenario. Each step should be a specific action (e.g., "Click on Login button", "Enter username in email field", "Submit the form"). Keep steps atomic and actionable.'),
        expectedOutcomes: z
          .array(z.string())
          .describe('List of expected outcomes that can be verified. Each outcome should be simple, specific, and easy to check (e.g., "Success message appears", "URL changes to /dashboard", "Form field shows error"). Keep outcomes atomic - do not combine multiple checks into one.'),
      })
    )
    .describe('List of testing scenarios'),
});

const PlannerBase = WithSessionDedup(WithSubPages(Object as unknown as new (...args: any[]) => object));

export class Planner extends PlannerBase implements Agent {
  emoji = '📋';
  private explorer: Explorer;
  provider: Provider;
  stateManager: StateManager;
  private experienceTracker: ExperienceTracker;

  MIN_TASKS = 3;
  MAX_TASKS = 12;
  currentPlan: Plan | null = null;
  freshStart = false;
  private lastStyleName = '';
  private lastSuite: Suite | null = null;
  researcher: Researcher;
  private fisherman: Fisherman | null = null;

  constructor(explorer: Explorer, provider: Provider) {
    super();
    this.explorer = explorer;
    this.provider = provider;
    this.researcher = new Researcher(explorer, provider);
    this.stateManager = explorer.getStateManager();
    this.experienceTracker = new ExperienceTracker();
  }

  setFisherman(fisherman: Fisherman): void {
    this.fisherman = fisherman;
  }

  private get sectionOrder(): string[] {
    return ConfigParser.getInstance().getConfig().ai?.agents?.researcher?.sections || Object.keys(POSSIBLE_SECTIONS);
  }

  getSystemMessage(feature?: string): string {
    const currentUrl = this.stateManager.getCurrentState()?.url;
    const customPrompt = this.provider.getSystemPromptForAgent('planner', currentUrl);
    const featureDirective = feature
      ? `\n    IMPORTANT: The user requested to focus specifically on: "${feature}"\n    ALL scenarios MUST be directly related to this feature. Do not propose generic page tests unrelated to it.\n    Use the user's exact wording to guide scenario names — do not substitute different entities (e.g., do not plan "suite" actions when user said "test").`
      : '';
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
      NEVER split one workflow into multiple tests. Each test must be a complete end-to-end flow.
      Bad: "Open delete dropdown" + "Confirm deletion" — these are ONE test, not two.
      Bad: "Search for X" + "Verify search results" — searching and verifying is ONE test.
      Bad: "Leave field empty" + "Click submit" — that's one negative test, not two.
      If two scenarios cannot run independently (one requires the other to run first), merge them into one.${featureDirective}
    </task>

    ${customPrompt || ''}
    `;
  }

  setPlan(plan: Plan): void {
    this.currentPlan = plan;
  }

  static getCachedPlan(url: string): Plan | null {
    return getRegisteredPlan(url)?.plan || null;
  }

  async plan(feature?: string, style?: string, parentPlan?: Plan, completedPlans?: Plan[]): Promise<Plan> {
    Stats.plans++;
    const state = this.stateManager.getCurrentState();
    debugLog('Planning:', state?.url);
    if (!state) throw new Error('No state found');

    if (!feature && !this.currentPlan && state.url) {
      const similar = this.findSimilarPlan(state.url);
      if (similar) {
        tag('info').log(`Similar page already planned: ${similar.url} (${similar.plan.tests.length} tests)`);
        this.registerPlanInSession(similar.plan);
        return similar.plan;
      }

      const actionResult = ActionResult.fromState(state);
      const combinedHtml = await actionResult.combinedHtml();
      const similarHash = await findSimilarStateHash(combinedHtml);
      if (similarHash) {
        const planned = getPlannedByStateHash(similarHash);
        if (planned) {
          tag('info').log(`Page content similar to already-planned: ${planned.url} — skipping`);
          this.registerPlanInSession(planned.plan);
          return planned.plan;
        }
      }
    }

    if (!this.freshStart && !this.currentPlan && state.url) {
      this.currentPlan = Planner.getCachedPlan(state.url);
      if (this.currentPlan) {
        tag('step').log(`Loaded cached plan: "${this.currentPlan.title}"`);
      }
    }
    this.freshStart = false;

    setActivity(`${this.emoji} Planning...`, 'action');
    tag('info').log(`Planning test scenarios for ${state.url}`);
    if (style) tag('info').log(`Planning style: ${style}`);

    const tags = ['planner'];
    if (style) tags.push(style);
    const result = await Observability.run(`planner: ${state.url}`, { tags, sessionId: state.url }, async () => {
      const actionResult = ActionResult.fromState(state);
      const conversation = await this.buildConversation(actionResult, style, parentPlan, feature);

      if (feature) {
        tag('step').log(`Focusing on ${feature}`);
        conversation.addUserText(`CRITICAL: Every scenario must focus on: "${feature}". Use the user's exact wording — do not substitute different entities. Skip unrelated page elements.`);
      } else {
        tag('step').log('Focusing on main content of this page');
      }

      debugLog('Sending planning prompt to AI provider with structured output');

      const aiResult = await this.provider.generateObject(conversation.messages, TasksSchema, conversation.model);

      if (!aiResult?.object?.scenarios) {
        throw new Error('No tasks were created successfully');
      }

      if (aiResult.object.scenarios.length === 0 && !this.currentPlan) {
        throw new Error('No tasks were created successfully');
      }

      const fromPlanning = aiResult.object.scenarios.map((s: any) => new Test(s.scenario, s.priority, s.expectedOutcomes, s.startUrl || state.url, s.steps || []));

      return { tests: fromPlanning, planName: aiResult.object.planName };
    });

    const tests = result.tests;
    debugLog('Created tests:', tests);

    if (!this.currentPlan) {
      const cached = state.url ? getRegisteredPlan(state.url) : null;
      const planName = feature || cached?.plan.title || result.planName || state.url;
      this.currentPlan = new Plan(planName);
      this.currentPlan.url = state.url;
      if (parentPlan) this.currentPlan.parentPlan = parentPlan;
      const allPreviousScenarios = this.getPreviousSessionScenarios();
      const existingTestScenarios = this.getExistingTestFileScenarios(state.url);
      for (const s of existingTestScenarios) allPreviousScenarios.add(s);
      for (const t of tests) {
        if (allPreviousScenarios.has(t.scenario.toLowerCase())) continue;
        t.style = this.lastStyleName;
        t.startUrl = state.url;
        this.currentPlan.addTest(t);
      }
    } else {
      tag('step').log(`Expanding plan: "${this.currentPlan.title}"`);
      this.currentPlan.nextIteration();
      const newTests = this.addNewTests(tests, state.url);
      if (newTests.length > 0) {
        const summary = `New scenarios:\n${newTests.map((t) => `+ [${t.priority}] ${t.scenario}`).join('\n')}`;
        tag('multiline').log(summary);
      }
    }

    const availableStyles = Object.keys(getStyles()).join(', ');
    tag('success').log(`Planning complete! ${this.currentPlan.tests.length} tests in plan: ${this.currentPlan.title}`);
    tag('info').log(`Planning style: ${this.lastStyleName} (available: ${availableStyles})`);

    if (state.url) registerPlan(state.url, this.currentPlan, feature, state.hash);

    this.registerPlanInSession(this.currentPlan);

    return this.currentPlan;
  }

  getSuite(): Suite | null {
    return this.lastSuite;
  }

  private addNewTests(tests: Test[], defaultStartUrl: string): Test[] {
    if (!this.currentPlan) return [];

    const existingScenarios = new Set(this.currentPlan.getAllTests().map((t) => t.scenario.toLowerCase()));
    const added: Test[] = [];

    const allPreviousScenarios = this.getPreviousSessionScenariosExcluding(this.currentPlan);

    for (const test of tests) {
      if (existingScenarios.has(test.scenario.toLowerCase())) continue;
      if (allPreviousScenarios.has(test.scenario.toLowerCase())) continue;

      test.style = this.lastStyleName;
      test.startUrl = test.startUrl || defaultStartUrl;
      test.plan = this.currentPlan;
      this.currentPlan.addTest(test);
      existingScenarios.add(test.scenario.toLowerCase());
      added.push(test);
    }

    return added;
  }

  private getExistingTestFileScenarios(currentUrl?: string): Set<string> {
    if (!currentUrl) return new Set<string>();
    try {
      this.lastSuite = new Suite(currentUrl);
      return this.lastSuite.getActiveScenarioTitles();
    } catch (err: any) {
      debugLog('Failed to load existing test files: %s', err.message);
      return new Set<string>();
    }
  }

  private cleanExperienceFlows(text: string): string | null {
    const seenTitles = new Set<string>();
    let result = text;

    for (const section of [...mdq(text).query('section2').each(), ...mdq(text).query('section3').each()]) {
      const heading = section.query('heading').text().trim();
      const body = mdq(section.text())
        .query('heading')
        .replace('')
        .replace(/^---\s*$/gm, '')
        .trim();

      if (!body || seenTitles.has(heading)) {
        result = result.replace(section.text(), '');
        continue;
      }
      seenTitles.add(heading);

      const blockquotes = section.query('blockquote').each();
      if (blockquotes.length <= 10) continue;
      for (const bq of blockquotes.slice(10)) {
        result = result.replace(bq.text(), '');
      }
      result = result.replace(section.text().trim(), `${section.text().trim()}\n> ... and ${blockquotes.length - 10} more discoveries`);
    }

    return result.trim() || null;
  }

  private buildApproach(style?: string): string {
    const { name, approach } = getActiveStyle(this.currentPlan?.iteration || 0, style);
    this.lastStyleName = name;
    return `Your approach is ${name} testing:\n<approach>\n${approach}\n</approach>`;
  }

  private async buildConversation(state: ActionResult, style?: string, parentPlan?: Plan, feature?: string): Promise<Conversation> {
    const model = this.provider.getAgenticModel('planner');
    const conversation = new Conversation([], model);
    conversation.autoTrimTag('page_research', 20000);
    conversation.autoTrimTag('tested_scenarios', 10000);

    conversation.addUserText(this.getSystemMessage(feature));

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
      <priority_order>
      Tests that change application data are MORE valuable than tests that only change the UI display.
      Prioritize interactions that create, update, or delete data — these test real application behavior.
      Tests that only switch views, toggle filters, or paginate are LESS valuable — propose them only after data-changing tests are covered.
      If multiple ways to create or modify data exist (different types, different forms), propose a separate test for each.
      </priority_order>
      ${protectionRule}
      ${fileUploadRule}
      </rules>

      ${this.buildApproach(style)}

      <context>
      URL: ${state.url || 'Unknown'}
      Title: ${state.title || 'Unknown'}
      </context>
    `;

    conversation.addUserText(planningPrompt);
    const currentState = this.stateManager.getCurrentState();
    const research = await this.researcher.research(currentState || state, {
      deep: true,
    });
    let plannerResearch = mdq(research).query('code').replace('');
    for (const table of mdq(plannerResearch).query('table').each()) {
      const rawTable = table.text();
      const rows = table.toJson();
      if (rows.length === 0 || !rows[0].Element) continue;
      const elementWithType = rows.map((r) => ({
        Element: r.Element,
        Type: r.Type || '',
      }));
      plannerResearch = plannerResearch.replace(rawTable, jsonToTable(elementWithType, ['Element', 'Type']));
    }

    const hasFocusedOverlay = hasFocusedSection(plannerResearch);
    const focusNote = hasFocusedOverlay ? "IMPORTANT: One section is marked as **Focused** — this is the user's current focus area. Concentrate testing on the Focused section FIRST — test all interactions inside it before planning tests for the rest of the page." : '';
    const featureFilter = feature ? `FOCUS FILTER: Only propose scenarios using elements relevant to "${feature}". Ignore all other elements.` : '';

    conversation.addUserText(dedent`
      <page_research>
      The following research describes ALL interactive elements on the page, organized by sections.
      Each numbered section and each Extended Research subsection represents a testable feature area.
      Skip the Menu/Navigation section — we test THIS page, not navigation away from it.
      ${featureFilter}
      ${focusNote}

      ${plannerResearch}
      </page_research>
    `);

    if (this.fisherman) {
      await this.fisherman.ensureReady(state.url);
      if (this.fisherman.isAvailable()) {
        const endpointList = this.fisherman.getEndpointList(state.url);
        if (endpointList) {
          conversation.addUserText(dedent`
            <api_data_preparation>
            An API is available to create test data before tests run (preconditions).
            The following write endpoints were observed or configured:

            ${endpointList}

            Use this knowledge to understand the data model beyond what the UI shows.
            When planning scenarios that need specific data (edit, delete, filter, sort), note that
            preconditions can create that data via API before the test starts.
            For example: "Edit a post" test can have a precondition "1 post to edit" created via API.
            </api_data_preparation>
          `);
        }
      }
    }

    if (!feature) {
      const rawFlows = this.experienceTracker.getSuccessfulExperience(state, { includeDescendants: true, stripCode: true });
      const flows = rawFlows.map((f) => this.cleanExperienceFlows(f)).filter(Boolean) as string[];
      if (flows.length > 0) {
        conversation.addUserText(dedent`
          <previously_tested_flows>
          You are provided with previously tested scenarios.
          This information is used to increase the testing coverage and discover untested paths.

          These flows have been tested before on this URL:

          ${flows.join('\n\n')}

          Blockquote items are discoveries made during those flows (buttons, fields, options that appeared).
          They show new elements that appeared during the flow.
          Use them in your tests if needed, depending on the <approach>.
          </previously_tested_flows>
        `);
      }
    }

    if (this.lastSuite && this.lastSuite.automatedTestCount > 0) {
      const automatedNames = this.lastSuite.getAutomatedTestNames();
      conversation.addUserText(dedent`
        <existing_automated_tests>
        The following ${automatedNames.length} tests are already implemented and automated for this URL.
        Do not propose tests that duplicate these:
        ${automatedNames.map((n) => `- ${n}`).join('\n')}
        </existing_automated_tests>
      `);
    }

    if (this.currentPlan) {
      tag('step').log('Analyzing current plan to expand testing');

      const allTests = this.currentPlan.getAllTests();
      const titleListing = allTests.map((t) => `- "${t.scenario}" [${t.result || 'pending'}]`).join('\n');
      const compactContext = planToCompactAiContext(this.currentPlan);

      conversation.addUserText(dedent`
        CRITICAL: This plan already has tests.

        <absolute_rules>
        1. DO NOT re-propose tests with the same scenario name or identical steps
        2. You CAN propose tests for the same feature if they test a genuinely different operation (create vs edit vs delete)
        3. A group of identical elements counts as ONE feature — one tab test covers tabs, one suite link covers suite navigation
        4. Do NOT propose tests that only differ by trivial input data (e.g., "Search X" and "Search Y"), except when the <approach> requires systematic valid combinatorial coverage per control — then separate scenarios for distinct select options, meaningful checkbox combinations, or alternate valid field values are allowed
        5. Do NOT split one workflow into sequential tests (e.g., "Open modal" + "Fill form in modal" = ONE test)
        6. If no genuinely new operations or features remain, return EMPTY scenarios array
        </absolute_rules>

        All tested scenario titles (DO NOT duplicate any of these):
        ${titleListing}

        <tested_scenarios>
        ${compactContext}
        </tested_scenarios>

        <planning_strategy>
        Find a feature area in the research that has NO or minimal test coverage.
        Pick that ONE feature and propose ${this.MIN_TASKS}-${this.MAX_TASKS} tests for it.
        ${mdq(plannerResearch).query('section("Extended Research")').count() > 0 ? 'IMPORTANT: The research contains "Extended Research" sections with dropdowns, modals, and panels. Prioritize testing features from Extended Research that have no coverage yet.' : ''}

        Follow the <approach> described above when proposing tests for this feature.

        If ALL features across ALL research sections are covered, return empty scenarios array.
        </planning_strategy>

        <context_from_previous_tests>
        During testing, the following pages were visited:
        ${this.currentPlan
          .getVisitedPages()
          .map((s) => `- ${s.url} (${s.title || 'untitled'})`)
          .join('\n')}

        You MAY propose tests starting from these pages if they are relevant to the plan "${this.currentPlan.title}".
        Set startUrl for such tests. Ignore pages that belong to a different feature area.
        </context_from_previous_tests>

        Propose ONLY new scenarios that are NOT in the existing tests list.
        `);
    }

    const sessionTests = this.getSessionTestsSummary();
    if (sessionTests) {
      conversation.addUserText(dedent`
        Tests already planned in this session across all pages. DO NOT duplicate any of these:

        <session_tests>
        ${sessionTests}
        </session_tests>
      `);
    }

    if (parentPlan && !this.currentPlan) {
      const parentTests = parentPlan.tests.map((t) => `- "${t.scenario}"`).join('\n');
      conversation.addUserText(dedent`
        <parent_page_context>
        This is a SUBPAGE of a page that already has these tests planned:
        ${parentTests}

        DO NOT propose tests that overlap with parent page tests even if the wording differs.
        Focus ONLY on features and interactions UNIQUE to this subpage.
        </parent_page_context>
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
         - NEVER split a workflow across two tests. One test = one complete action + its verification

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
      ${hasCurrentPlan ? '8. CRITICAL: Return ONLY NEW scenarios not in the existing tests list. Return empty array if no new tests needed.' : `8. At least ${this.MIN_TASKS} tests should be proposed.`}
    </task>
    `;

    conversation.addUserText(tasksMessage);

    return conversation;
  }
}
