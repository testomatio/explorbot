import dedent from 'dedent';
import { z } from 'zod';
import { ActionResult } from '../action-result.ts';
import { setActivity } from '../activity.ts';
import { ExperienceTracker } from '../experience-tracker.ts';
import type Explorer from '../explorer.ts';
import { Observability } from '../observability.ts';
import type { StateManager } from '../state-manager.js';
import { Stats } from '../stats.ts';
import { Plan, Test } from '../test-plan.ts';
import { collectInteractiveNodes } from '../utils/aria.ts';
import { createDebug, tag } from '../utils/logger.js';
import type { Agent } from './agent.js';
import { Conversation } from './conversation.ts';
import type { Provider } from './provider.js';
import { Researcher } from './researcher.ts';
import { protectionRule } from './rules.ts';

const debugLog = createDebug('explorbot:planner');

const planCache: Map<string, Plan> = new Map();

const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2, unknown: 3 };

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
  reasoning: z.string().describe('Brief explanation of the scenario selection'),
});

let planId = 0;
export class Planner implements Agent {
  emoji = '📋';
  private explorer: Explorer;
  private provider: Provider;
  private stateManager: StateManager;
  private experienceTracker: ExperienceTracker;

  MIN_TASKS = 3;
  MAX_TASKS = 7;
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

  getSystemMessage(): string {
    const customPrompt = this.provider.getSystemPromptForAgent('planner');
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

    const tests = await Observability.run('planner.plan', { tags: ['planner'] }, async () => {
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

      const result = await this.provider.generateObject(conversation.messages, TasksSchema, conversation.model);

      if (!result?.object?.scenarios) {
        throw new Error('No tasks were created successfully');
      }

      if (result.object.scenarios.length === 0 && !this.currentPlan && allTests.length === 0) {
        throw new Error('No tasks were created successfully');
      }

      tag('substep').log(result.object.reasoning);

      const fromPlanning = result.object.scenarios.map((s: any) => new Test(s.scenario, s.priority, s.expectedOutcomes, state.url, s.steps || []));
      allTests.push(...fromPlanning);

      return allTests;
    });

    debugLog('Created tests:', tests);

    if (!this.currentPlan) {
      const planName = `Plan ${planId++}`;
      this.currentPlan = new Plan(planName);
      this.currentPlan.url = state.url;
      for (const t of tests) {
        t.startUrl = state.url;
        this.currentPlan.addTest(t);
      }
    } else {
      tag('step').log(`Expanding plan: "${this.currentPlan.title}"`);
      this.currentPlan.nextIteration();
      const addedCount = this.addNewTests(tests, state.url);
      if (addedCount > 0) {
        tag('step').log(`Added ${addedCount} new scenarios`);
      }
    }

    this.currentPlan.tests = this.sortTestsByPriority(this.currentPlan.tests);

    const summary = `Scenarios:\n${this.currentPlan.tests.map((t) => `- [${t.priority}] ${t.scenario} ${t.result ? `[${t.result}]` : ''}`).join('\n')}`;
    tag('multiline').log(summary);
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

    const statesWithAria = unanalyzedStates.filter((state) => state.ariaSnapshot);
    if (statesWithAria.length === 0) {
      tag('substep').log(`Found ${unanalyzedStates.length} visited pages but none have ARIA snapshots`);
      for (const state of unanalyzedStates) {
        this.analyzedUrls.add(state.url);
      }
      return [];
    }

    tag('step').log(`Analyzing ${statesWithAria.length} visited pages for new test scenarios`);

    for (const state of unanalyzedStates) {
      this.analyzedUrls.add(state.url);
    }

    const statesContext = statesWithAria
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

    if (statesContext.length === 0) {
      tag('substep').log('No interactive elements found in visited pages');
      return [];
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
    ];

    const result = await this.provider.generateObject(messages, schema, this.provider.getModelForAgent('planner'));

    const suggestions = result?.object?.tests || [];
    const newTests: Test[] = [];

    for (const suggestion of suggestions) {
      const test = new Test(suggestion.scenario, 'medium', [], suggestion.triggerUrl, [suggestion.firstStep]);
      newTests.push(test);
    }

    if (newTests.length > 0) {
      debugLog(`Discovered ${newTests.length} new test paths from visited states`);
    }

    return newTests;
  }

  private sortTestsByPriority(tests: Test[]): Test[] {
    return tests.sort((a, b) => {
      const aHasResult = a.result !== null;
      const bHasResult = b.result !== null;
      if (aHasResult !== bHasResult) return aHasResult ? 1 : -1;
      return (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3);
    });
  }

  private detectUIContext(ariaSnapshot: string): string | null {
    if (!ariaSnapshot) return null;
    if (ariaSnapshot.includes('dialog') || ariaSnapshot.includes('modal')) return 'modal open';
    if (ariaSnapshot.includes('tabpanel')) return 'tab panel active';
    if (ariaSnapshot.includes('menu[expanded=true]')) return 'menu expanded';
    return null;
  }

  private extractFlowsFromExperience(state: ActionResult): string[] {
    const relevantExperience = this.experienceTracker.getRelevantExperience(state);
    const flows: string[] = [];

    for (const experience of relevantExperience) {
      const flowMatches = experience.content.matchAll(/^## Flow[^\n]*\n([\s\S]*?)(?=^## |\z)/gm);
      for (const match of flowMatches) {
        flows.push(match[0].trim());
      }
    }

    return flows;
  }

  private addNewTests(tests: Test[], defaultStartUrl: string): number {
    if (!this.currentPlan) return 0;

    const existingScenarios = new Set(this.currentPlan.tests.map((t) => t.scenario.toLowerCase()));
    let addedCount = 0;

    for (const test of tests) {
      if (existingScenarios.has(test.scenario.toLowerCase())) continue;

      test.startUrl = test.startUrl || defaultStartUrl;
      test.plan = this.currentPlan;
      this.currentPlan.addTest(test);
      existingScenarios.add(test.scenario.toLowerCase());
      addedCount++;
    }

    return addedCount;
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
         - HIGH: Security-related scenarios (authentication, authorization, XSS, CSRF, injection)
         - HIGH: Critical business functionality, main user flows
         - MEDIUM: Happy path scenarios, standard features
         - LOW: Edge cases, input validation, boundary testing, negative scenarios
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

      const existingScenarios = this.currentPlan.tests.map((t) => `- "${t.scenario}" [${t.priority}] ${t.result ? `[${t.result}]` : '[pending]'}`).join('\n');

      conversation.addUserText(dedent`
        CRITICAL: This plan already has tests (${summary}).

        <existing_tests_do_not_repeat>
        ${existingScenarios}
        </existing_tests_do_not_repeat>

        <absolute_rules>
        1. DO NOT propose any test that matches or is similar to tests listed above
        2. DO NOT rephrase existing tests - they are already in the plan
        3. ONLY propose completely NEW scenarios not covered above
        4. If a test failed, do NOT retry the same scenario - find alternative approaches
        5. If no new tests are needed, return empty scenarios array
        </absolute_rules>

        <previous_test_results>
        ${this.currentPlan.toAiContext()}
        </previous_test_results>

        <planning_strategy>
        Prioritize discovering NEW testing paths over edge cases for existing scenarios.
        Look for unexplored features, buttons, or flows not yet covered.
        Edge case and negative testing should only be proposed when no new paths remain.
        </planning_strategy>

        <context_from_previous_tests>
        Pages visited during testing:
        ${this.currentPlan
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

        Propose ONLY new scenarios that are NOT in the existing tests list.
        `);
    }

    const hasCurrentPlan = !!this.currentPlan;
    const tasksMessage = dedent`
    <task>
      Provide testing scenarios as structured data with the following requirements:
      1. Create a short, descriptive plan name that summarizes what will be tested (e.g., "User Authentication Testing", "Product Catalog Navigation", "Form Validation Tests")
      2. Assign priorities based on:
         - HIGH: Security-related scenarios, critical business flows
         - MEDIUM: Happy path scenarios, standard user features
         - LOW: Edge cases, input validation, boundary testing, negative scenarios
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
      ${hasCurrentPlan ? '8. CRITICAL: Return ONLY NEW scenarios not in the existing tests list. Return empty array if no new tests needed.' : `8. At least ${this.MIN_TASKS} tests should be proposed.`}
    </task>
    `;

    conversation.addUserText(tasksMessage);

    conversation.autoTrimTag('page_content', 5000);
    return conversation;
  }
}
