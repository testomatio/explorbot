import dedent from 'dedent';
import { z } from 'zod';
import { Conversation } from '../../../../src/ai/conversation.ts';
import { WithSessionDedup } from '../../../../src/ai/planner/session-dedup.ts';
import type { AIProvider } from '../../../../src/ai/provider.ts';
import type { KnowledgeTracker } from '../../../../src/knowledge-tracker.ts';
import { Observability } from '../../../../src/observability.ts';
import { Plan, Test } from '../../../../src/test-plan.ts';
import { createDebug, tag } from '../../../../src/utils/logger.ts';
import { RulesLoader } from '../../../../src/utils/rules-loader.ts';
import { isSecretName, registerSecret } from '../../../../src/utils/secrets.ts';
import type { ApiClient } from '../api-client.ts';
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

const NamedValueSchema = z.object({ name: z.string(), value: z.string() });

const RequestDefaultsSchema = z.object({
  files: z
    .array(
      z.object({
        file: z.number().describe('Number of the knowledge file the values come from'),
        headers: z.array(NamedValueSchema).describe('Headers to send, each value exactly as it goes on the wire'),
        query: z.array(NamedValueSchema).describe('Query parameters to send'),
        body: z.array(NamedValueSchema).describe('Fields a request body must contain, each value as a JSON literal'),
      })
    )
    .describe('One entry per knowledge file that names values to send with requests'),
});

const ChiefBase = WithSessionDedup(Object as unknown as new (...args: any[]) => object);

export class Chief extends ChiefBase {
  private provider: AIProvider;
  private config: ApibotConfig;
  private apiClient: ApiClient | null;
  private knowledgeTracker?: KnowledgeTracker;
  currentPlan: Plan | null = null;
  private lastStyleName = '';
  private readKnowledgeFiles = new Set<string>();

  MIN_TASKS = 3;
  MAX_TASKS = 10;

  constructor(provider: AIProvider, config: ApibotConfig, apiClient?: ApiClient | null, knowledgeTracker?: KnowledgeTracker) {
    super();
    this.provider = provider;
    this.config = config;
    this.apiClient = apiClient || null;
    this.knowledgeTracker = knowledgeTracker;
  }

  async plan(endpoint: string, opts?: { style?: string; specDefinition?: string }): Promise<Plan> {
    tag('info').log(`Planning API tests for ${endpoint}`);
    if (opts?.style) tag('info').log(`Planning style: ${opts.style}`);

    debugLog('Sending planning prompt to AI provider');

    await Observability.run(`chief: ${endpoint}`, { tags: ['chief'], sessionId: endpoint }, async () => {
      await this.prepareRequestDefaults(endpoint);
      const sampleData = await this.collectSampleData(endpoint);
      const conversation = this.buildConversation(endpoint, opts?.style, sampleData);

      const knowledge = this.knowledgeTracker?.renderEndpointKnowledge(endpoint);
      if (knowledge) conversation.addUserText(knowledge);

      if (opts?.specDefinition) {
        conversation.addUserText(dedent`
          <api_spec>
          ${opts.specDefinition}
          </api_spec>

          NOTE: The spec may show absolute paths (e.g. /api/) but the base URL is ${this.config.api.baseEndpoint}.
        `);
      }

      const aiResult = await this.provider.generateObject(conversation.messages, ApiTasksSchema, conversation.model, {
        agentName: 'chief',
        timeout: 120_000,
      });

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

  private async prepareRequestDefaults(endpoint: string): Promise<void> {
    if (!this.apiClient) return;
    const files = (this.knowledgeTracker?.getEndpointKnowledge(endpoint) || []).filter((knowledge) => !this.readKnowledgeFiles.has(knowledge.filePath));
    if (!files.length) return;

    const knowledgeFiles = files.map((knowledge, index) => `<file number="${index + 1}" endpoint="${knowledge.endpoint}">\n${knowledge.content}\n</file>`).join('\n\n');
    const prompt = dedent`
      <task>
      Extract the values these knowledge files say must be sent with API requests:
      - headers: authentication, API keys and other headers, written exactly as sent (include the auth scheme when one is named)
      - query: query parameters requests need
      - body: fields request bodies must contain, each value written as a JSON literal
      Copy values exactly as written. Never invent a value. Skip facts that are not about what to send.
      </task>

      <knowledge_files>
      ${knowledgeFiles}
      </knowledge_files>
    `;

    const result = await this.provider.generateObject([{ role: 'user', content: prompt }], RequestDefaultsSchema, this.provider.getModelForAgent('chief'), { agentName: 'chief' }).catch((error: Error) => {
      tag('warning').log(`Could not read request defaults from knowledge: ${error.message}`);
      return null;
    });
    if (!result) return;
    for (const knowledge of files) this.readKnowledgeFiles.add(knowledge.filePath);

    const entries: z.infer<typeof RequestDefaultsSchema>['files'] = result.object?.files || [];
    for (const entry of entries) {
      const knowledge = files[entry.file - 1];
      if (!knowledge?.endpoint) continue;

      const headers = Object.fromEntries(entry.headers.map(({ name, value }) => [name, value]));
      const query = Object.fromEntries(entry.query.map(({ name, value }) => [name, value]));
      const body = Object.fromEntries(entry.body.map(({ name, value }) => [name, parseJsonLiteral(value)]));
      const sent = Object.entries({ headers, query, body }).filter(([, values]) => Object.keys(values).length);
      if (!sent.length) continue;

      for (const [name, value] of sent.flatMap(([, values]) => Object.entries(values))) {
        if (isSecretName(name)) registerSecret(String(value));
      }
      this.apiClient.addRequestDefaults({ pattern: knowledge.endpoint, headers, query, body });
      tag('info').log(`Request defaults from knowledge for ${knowledge.endpoint}: ${sent.map(([kind, values]) => `${kind} ${Object.keys(values).join(', ')}`).join('; ')}`);
    }
  }

  private async collectSampleData(endpoint: string): Promise<string> {
    if (!this.apiClient) return '';

    tag('info').log(`Collecting sample data for ${endpoint}`);

    try {
      const listResult = await this.apiClient.request({ method: 'GET', path: endpoint });
      if (listResult.error || listResult.status >= 400) {
        tag('warning').log(`Sample data fetch failed: ${listResult.error || listResult.status}`);
        return '';
      }

      const body = listResult.responseBody;
      if (!body) return '';

      const items = Array.isArray(body) ? body : Array.isArray(body.data) ? body.data : Array.isArray(body.items) ? body.items : [];
      if (!items.length) return '';

      const sampleItem = items[0];
      const fields = Object.keys(sampleItem);
      const idField = fields.find((f) => f === '_id' || f === 'id');

      let detailItem = sampleItem;
      if (idField && items.length > 0) {
        const detailResult = await this.apiClient.request({ method: 'GET', path: `${endpoint}/${sampleItem[idField]}` });
        if (!detailResult.error && detailResult.status < 400) {
          const detailBody = detailResult.responseBody;
          if (detailBody?.data) detailItem = detailBody.data;
          else if (detailBody && !Array.isArray(detailBody)) detailItem = detailBody;
        }
      }

      const lines: string[] = [];
      lines.push(`Records found: ${body.meta?.total || items.length}`);
      lines.push(`Fields: ${fields.join(', ')}`);

      const ids: string[] = [];
      for (const item of items.slice(0, 10)) {
        const id = item._id || item.id;
        if (id) ids.push(String(id));
      }
      if (ids.length) lines.push(`IDs: ${ids.join(', ')}`);

      const foreignKeys: Record<string, Set<string>> = {};
      const stringValues: Record<string, Set<string>> = {};

      for (const item of items.slice(0, 30)) {
        for (const [key, val] of Object.entries(item)) {
          if (key.endsWith('_id') && val != null) {
            foreignKeys[key] ||= new Set();
            if (foreignKeys[key].size < 5) foreignKeys[key].add(String(val));
          }
          if (typeof val === 'string' && val.length > 0 && val.length < 100 && key !== 'id' && key !== '_id') {
            stringValues[key] ||= new Set();
            if (stringValues[key].size < 10) stringValues[key].add(val);
          }
        }
      }

      for (const [key, vals] of Object.entries(foreignKeys)) {
        lines.push(`${key}: ${[...vals].join(', ')}`);
      }

      for (const [key, vals] of Object.entries(stringValues)) {
        if (vals.size < items.length * 0.8) {
          lines.push(`${key} values: ${[...vals].join(', ')}`);
        }
      }

      const truncatedSample: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(detailItem)) {
        if (typeof val === 'string' && val.length > 100) {
          truncatedSample[key] = `${val.substring(0, 100)}...`;
        } else {
          truncatedSample[key] = val;
        }
      }
      lines.push(`Sample record: ${JSON.stringify(truncatedSample, null, 2)}`);

      const sampleData = lines.join('\n');
      tag('success').log('Sample data collected');
      debugLog('Sample data:', sampleData.substring(0, 500));
      return sampleData;
    } catch (error: any) {
      tag('warning').log(`Sample data collection failed: ${error.message}`);
      debugLog('collectSampleData error:', error);
      return '';
    }
  }

  private buildConversation(endpoint: string, style?: string, sampleData?: string): Conversation {
    const model = this.provider.getAgenticModel('chief');
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
      ${RulesLoader.loadRules('chief', ['general'], endpoint)}
      </rules>

      <context>
      Endpoint: ${endpoint}
      Base URL: ${this.config.api.baseEndpoint}
      Headers and authentication are handled automatically — do NOT include them in test steps.
      Steps should only contain relative paths (e.g. /tests, /tests/{id}), not full URLs.
      </context>
    `;

    conversation.addUserText(planningPrompt);

    if (sampleData) {
      conversation.addUserText(dedent`
        <sample_data>
        ${sampleData}
        </sample_data>

        Use this real data from the API when planning test scenarios:
        - Reference real existing IDs for parent record references (e.g. use actual milestone_id, project_id values)
        - Use real enum values discovered in the data
        - Each test MUST use DIFFERENT data — never reuse the same field values across tests
        - For "create" tests: base payload on a real record but change field values to create new unique data
        - Treat records and IDs from sample_data as read-only. Never update, patch, delete, archive, or otherwise mutate them
        - For update/delete tests: the same scenario must first create its own target, then mutate only that target
        - For negative or unsupported-method tests that could mutate data if accepted: create a scenario-owned target first; if that setup is impossible, do not send the destructive request
        - For tests needing parent references: use real _id field values from sample_data
      `);
    }

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

function parseJsonLiteral(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
