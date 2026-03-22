import dedent from 'dedent';
import { z } from 'zod';
import { Conversation } from '../../../../src/ai/conversation.ts';
import { WithSessionDedup } from '../../../../src/ai/planner/session-dedup.ts';
import type { AIProvider } from '../../../../src/ai/provider.ts';
import { Observability } from '../../../../src/observability.ts';
import { Plan, Test } from '../../../../src/test-plan.ts';
import { createDebug, tag } from '../../../../src/utils/logger.ts';
import type { ApibotConfig } from '../config.ts';
import { getActiveStyle, getStyles } from './chief/styles.ts';

const debugLog = createDebug('explorbot:chief');

const ApiTasksSchema = z.object({
  planName: z.string().describe('Short descriptive name for the API test plan'),
  scenarios: z
    .array(
      z.object({
        scenario: z.string().describe('A single sentence describing what to test'),
        priority: z.enum(['critical', 'important', 'high', 'normal', 'low']).describe('Priority based on API importance'),
        steps: z.array(z.string()).describe('List of HTTP requests/actions to perform (e.g., "POST /users with valid payload", "GET /users/{id} to verify creation")'),
        expectedOutcomes: z.array(z.string()).describe('List of verifiable outcomes (e.g., "Response status is 201", "Response body contains id field", "GET returns the created resource")'),
      })
    )
    .describe('List of testing scenarios'),
});

const ChiefBase = WithSessionDedup(Object as unknown as new (...args: any[]) => object);

export class Chief extends ChiefBase {
  private provider: AIProvider;
  private config: ApibotConfig;
  currentPlan: Plan | null = null;
  private lastStyleName = '';

  MIN_TASKS = 3;
  MAX_TASKS = 10;

  constructor(provider: AIProvider, config: ApibotConfig) {
    super();
    this.provider = provider;
    this.config = config;
  }

  async plan(endpoint: string, opts?: { style?: string; specDefinition?: string }): Promise<Plan> {
    tag('info').log(`Planning API tests for ${endpoint}`);
    if (opts?.style) tag('info').log(`Planning style: ${opts.style}`);

    const conversation = this.buildConversation(endpoint, opts?.style);

    if (opts?.specDefinition) {
      conversation.addUserText(dedent`
        <api_spec>
        ${opts.specDefinition}
        </api_spec>

        NOTE: The spec may show absolute paths (e.g. /api/v2/{project_id}/suites) but the base URL is ${this.config.api.baseEndpoint}.
        In planned steps, use ONLY relative paths after the base prefix: e.g. /suites, /suites/{id}.
      `);
    }

    debugLog('Sending planning prompt to AI provider');

    await Observability.run(`chief: ${endpoint}`, { tags: ['chief'], sessionId: endpoint }, async () => {
      const aiResult = await this.provider.generateObject(conversation.messages, ApiTasksSchema, conversation.model);

      if (!aiResult?.object?.scenarios?.length) {
        throw new Error('No test scenarios generated');
      }

      const tests = aiResult.object.scenarios.map((s: any) => new Test(s.scenario, s.priority, s.expectedOutcomes, endpoint, s.steps || []));

      if (!this.currentPlan) {
        const planName = aiResult.object.planName || `API Tests: ${endpoint}`;
        this.currentPlan = new Plan(planName);
        this.currentPlan.url = endpoint;
        const allPreviousScenarios = this.getPreviousSessionScenarios();
        for (const t of tests) {
          if (allPreviousScenarios.has(t.scenario.toLowerCase())) continue;
          t.style = this.lastStyleName;
          this.currentPlan.addTest(t);
        }
      } else {
        this.currentPlan.nextIteration();
        this.addNewTests(tests, endpoint);
      }
    });

    const summary = `Scenarios:\n${this.currentPlan.tests.map((t) => `- [${t.priority}] ${t.scenario}`).join('\n')}`;
    tag('multiline').log(summary);

    const availableStyles = Object.keys(getStyles()).join(', ');
    tag('success').log(`Planning complete! ${this.currentPlan.tests.length} tests in plan: ${this.currentPlan.title}`);
    tag('info').log(`Planning style: ${this.lastStyleName} (available: ${availableStyles})`);

    this.registerPlanInSession(this.currentPlan);

    return this.currentPlan;
  }

  private addNewTests(tests: Test[], defaultEndpoint: string): void {
    if (!this.currentPlan) return;

    const existing = new Set(this.currentPlan.tests.map((t) => t.scenario.toLowerCase()));
    const allPreviousScenarios = this.getPreviousSessionScenariosExcluding(this.currentPlan);

    for (const test of tests) {
      if (existing.has(test.scenario.toLowerCase())) continue;
      if (allPreviousScenarios.has(test.scenario.toLowerCase())) continue;
      test.style = this.lastStyleName;
      test.startUrl = test.startUrl || defaultEndpoint;
      this.currentPlan.addTest(test);
      existing.add(test.scenario.toLowerCase());
    }
  }

  private buildConversation(endpoint: string, style?: string): Conversation {
    const model = this.provider.getModelForAgent('chief');
    const conversation = new Conversation([], model);

    conversation.addUserText(this.getSystemMessage());

    const { name, approach } = getActiveStyle(this.currentPlan?.iteration || 0, style);
    this.lastStyleName = name;

    const planningPrompt = dedent`
      <task>
      Create ${this.MIN_TASKS}-${this.MAX_TASKS} API testing scenarios for endpoint: ${endpoint}
      Base URL: ${this.config.api.baseEndpoint}
      </task>

      <approach>
      ${approach}
      </approach>

      <rules>
      - Each scenario must be a complete, independent test
      - Steps should specify exact HTTP methods, paths, and key payload details
      - Expected outcomes should be specific and verifiable (status codes, response fields, error messages)
      - For CRUD operations, each test should handle its own setup and teardown
      - Expect standard REST conventions: 200 OK, 201 Created, 204 No Content, 400 Bad Request, 404 Not Found, 422 Unprocessable Entity
      - NEVER propose scenarios that test the same thing. "Create a basic suite" and "Successful creation of a simple suite" are DUPLICATES. Each scenario must test a DISTINCT behavior or aspect.
      - Before finalizing, review all scenarios and remove any that overlap in what they actually verify.
      </rules>

      <context>
      Endpoint: ${endpoint}
      Base URL: ${this.config.api.baseEndpoint}
      Default headers: ${JSON.stringify(this.config.api.headers || {})}
      </context>
    `;

    conversation.addUserText(planningPrompt);

    if (this.currentPlan) {
      const existingTests = this.currentPlan.tests
        .map((t) => {
          let entry = `- "${t.scenario}" [${t.priority}] [${t.result || 'pending'}]`;
          if (t.plannedSteps?.length) entry += `\n  Steps: ${t.plannedSteps.join('; ')}`;
          if (t.expected?.length) entry += `\n  Expects: ${t.expected.join('; ')}`;
          return entry;
        })
        .join('\n');

      conversation.addUserText(dedent`
        CRITICAL: This plan already has tests. Do NOT re-propose existing scenarios or SEMANTICALLY SIMILAR ones.

        <existing_tests>
        ${existingTests}
        </existing_tests>

        A scenario is a DUPLICATE if it tests the same behavior, even with different wording.
        For example, "Create a basic suite" and "Successful creation of a simple suite" test the same thing — both are basic POST creation.
        Propose ONLY scenarios that verify behaviors NOT already covered above.
        Return empty array if no new tests needed.
      `);
    }

    const sessionTests = this.getSessionTestsSummary();
    if (sessionTests) {
      conversation.addUserText(dedent`
        Tests already planned in this session across all endpoints. DO NOT duplicate any of these:

        <session_tests>
        ${sessionTests}
        </session_tests>
      `);
    }

    const tasksMessage = dedent`
      <task>
      Provide testing scenarios as structured data:
      1. Create a short plan name (e.g., "Users API CRUD Testing", "Auth Endpoint Validation")
      2. Assign priorities:
         - CRITICAL: Core CRUD operations
         - HIGH: listing and filtering and searching element
         - NORMAL: Input validation, error handling
         - NORMAL: Edge cases, boundary conditions
      3. For each scenario provide BOTH steps and expected outcomes
      4. Steps should be specific HTTP requests (e.g., "POST /users with {name: 'Test', email: 'test@test.com'}")
      5. Expected outcomes should be verifiable (e.g., "Status 201", "Response contains id field")
      </task>
    `;

    conversation.addUserText(tasksMessage);

    return conversation;
  }

  private getSystemMessage(): string {
    return dedent`
      <role>
      You are a senior API test engineer specializing in REST API testing.
      Your task is to plan comprehensive test scenarios for API endpoints.
      </role>

      <expertise>
      - HTTP methods and status codes
      - REST API conventions and best practices
      - Input validation and error handling patterns
      - Authentication and authorization testing
      - Data integrity and CRUD operations
      - Edge cases and boundary value analysis
      </expertise>
    `;
  }
}
