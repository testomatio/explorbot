import dedent from 'dedent';
import { z } from 'zod';
import type { AIProvider } from '../../../../src/ai/provider.ts';
import type { Reporter } from '../../../../src/reporter.ts';
import { type Test, TestResult } from '../../../../src/test-plan.ts';
import { createDebug, tag } from '../../../../src/utils/logger.ts';
import { loop } from '../../../../src/utils/loop.ts';
import type { ApiClient } from '../api-client.ts';
import type { RequestStateManager } from '../request-state.ts';
import { createCurlerTools } from './curler-tools.ts';

const debugLog = createDebug('explorbot:curler');

const MAX_ITERATIONS = 10;

export class Curler {
  private provider: AIProvider;
  private apiClient: ApiClient;
  private requestState: RequestStateManager;
  private reporter: Reporter;

  constructor(provider: AIProvider, apiClient: ApiClient, requestState: RequestStateManager, reporter: Reporter) {
    this.provider = provider;
    this.apiClient = apiClient;
    this.requestState = requestState;
    this.reporter = reporter;
  }

  async test(test: Test, opts?: { specDefinition?: string; baseEndpoint?: string; searchSpec?: (query: string) => string }): Promise<{ success: boolean }> {
    tag('info').log(`Testing: ${test.scenario}`);
    debugLog('Starting test:', test.scenario);

    this.requestState.clear();
    test.start();
    await this.reporter.reportTestStart(test);

    const conversation = this.provider.startConversation(this.getSystemMessage(), 'curler');
    const tools = createCurlerTools(this.apiClient, this.requestState, test, opts?.searchSpec);

    const initialPrompt = this.buildTestPrompt(test, opts?.specDefinition, opts?.baseEndpoint);
    conversation.addUserText(initialPrompt);

    await loop(
      async ({ stop, iteration }) => {
        debugLog(`Iteration ${iteration}`);

        if (iteration > 1) {
          const requestLog = this.requestState.toLog();
          const nextStep = dedent`
            <request_log>
            ${requestLog || 'No requests made yet'}
            </request_log>

            <task>
            Continue testing. Review the request log above and proceed with the next step.
            </task>

            <notes>
            ${test.notesToString() || 'No notes yet'}
            </notes>
          `;
          conversation.addUserText(nextStep);
        }

        const result = await this.provider.invokeConversation(conversation, tools, {
          maxToolRoundtrips: 5,
          toolChoice: 'required',
          agentName: 'curler',
        });

        if (!result) throw new Error('Failed to get response from provider');

        const toolNames = result.toolExecutions?.map((e: any) => e.toolName) || [];
        debugLog('Tool calls:', toolNames.join(', '));

        if (test.hasFinished) {
          stop();
          return;
        }

        if (iteration >= MAX_ITERATIONS) {
          tag('warning').log('Max iterations reached, running final review...');
          stop();
        }
      },
      {
        maxAttempts: MAX_ITERATIONS,
        observability: {
          name: `curler: ${test.scenario}`,
          agent: 'curler',
          sessionId: test.sessionName,
          metadata: {
            input: {
              scenario: test.scenario,
              startUrl: test.startUrl,
              expected: test.expected,
            },
          },
        },
        catch: async ({ error, stop }) => {
          tag('error').log(`Test execution error: ${error}`);
          stop();
        },
      }
    );

    await this.finalReview(test);
    this.finishTest(test);
    await this.reporter.reportTest(test);

    return { success: test.isSuccessful };
  }

  private finishTest(test: Test): void {
    if (!test.hasFinished) {
      test.finish(TestResult.FAILED);
    }
    tag('info').log(`Finished: ${test.scenario}`);
    tag('multiline').log(test.getPrintableNotes().join('\n'));

    if (test.isSuccessful) {
      tag('success').log(`Passed: ${test.scenario}`);
    } else if (test.isSkipped) {
      tag('warning').log(`Skipped: ${test.scenario}`);
    } else {
      tag('error').log(`Failed: ${test.scenario}`);
    }
  }

  private async finalReview(test: Test): Promise<void> {
    const notes = test.notesToString() || 'No notes recorded.';
    const requestLog = this.requestState.toLog() || 'No requests made.';
    const hasFailedNotes = test.getCheckedNotes().some((n) => n.status === TestResult.FAILED);
    const isUnfinished = !test.hasFinished;

    if (!hasFailedNotes && !isUnfinished) return;

    tag('info').log('Running final review...');

    const schema = z.object({
      summary: z.string().describe('One-line summary of test results'),
      goalsAchieved: z.boolean().describe('Whether the main test goals were accomplished'),
      failuresCritical: z.boolean().describe('Whether any assertion failures are critical enough to fail the test'),
      details: z.string().describe('Brief explanation of what passed, what failed, and why failures are or are not critical'),
    });

    const model = this.provider.getModelForAgent('curler');
    const response = await this.provider.generateObject(
      [
        {
          role: 'system',
          content: dedent`
            You evaluate API test results.
            Analyze notes and request log to determine if test goals were achieved.
            Decide if assertion failures are critical (should fail the test) or minor (test still passes).
            Critical failures: wrong HTTP status codes, missing required data, broken CRUD operations.
            Minor failures: optional fields missing, cosmetic differences, extra fields in response.
          `,
        },
        {
          role: 'user',
          content: dedent`
            Scenario: ${test.scenario}

            Expected outcomes:
            ${test.expected.map((e) => `- ${e}`).join('\n')}

            <notes>
            ${notes}
            </notes>

            <request_log>
            ${requestLog}
            </request_log>

            Evaluate:
            1. Were the expected outcomes achieved based on the request results?
            2. Are any assertion failures critical (wrong status codes, missing core data) or minor (optional fields, cosmetic)?
            3. Should the test pass or fail overall?
          `,
        },
      ],
      schema,
      model
    );

    const result = response?.object;
    if (!result) return;

    test.summary = result.summary;
    test.addNote(`Review: ${result.details}`);

    if (result.goalsAchieved && !result.failuresCritical) {
      test.addNote(result.summary, TestResult.PASSED);
      test.finish(TestResult.PASSED);
    } else {
      test.addNote(result.summary, TestResult.FAILED);
      test.finish(TestResult.FAILED);
    }
  }

  private buildTestPrompt(test: Test, specDefinition?: string, baseEndpoint?: string): string {
    let prompt = dedent`
      <task>
      SCENARIO: ${test.scenario}

      EXPECTED OUTCOMES:
      ${test.expected.map((e) => `- ${e}`).join('\n')}

      PLANNED STEPS:
      ${test.plannedSteps.map((s) => `- ${s}`).join('\n')}

      ENDPOINT: ${test.startUrl}

      Execute the test by making HTTP requests using the request tool.
      Use verifyStructure and verifyData to check responses.
      Use record to document findings.
      Use finish when all goals are achieved.
      Use stop only if the scenario is fundamentally impossible.
      </task>
    `;

    if (specDefinition) {
      let specBlock = `\n\n<api_spec>\n${specDefinition}\n</api_spec>`;
      if (baseEndpoint) {
        specBlock += dedent`

          <path_mapping>
          IMPORTANT: The spec shows absolute paths (e.g. /api/v2/{project_id}/suites) but the base URL is ${baseEndpoint}.
          The request tool prepends the base URL automatically.
          Use ONLY the relative path after the base prefix: e.g. /suites, /suites/{id} — NOT the full spec path.
          </path_mapping>
        `;
      }
      prompt += specBlock;
    }

    return prompt;
  }

  private getSystemMessage(): string {
    return dedent`
      <role>
      You are a senior API test engineer. Execute HTTP requests to test API endpoints.
      Validate responses against expectations.
      </role>

      <approach>
      1. Use the request tool to make HTTP calls — response preview shows first 500 chars
      2. If you need a related endpoint (e.g., to create prerequisite data), use schemaFor to discover it
      3. Extract IDs and key values from the response preview to chain requests
      4. After each request, use verifyStructure with a Zod schema to validate response shape
         Example: schema = "z.object({ id: z.number(), name: z.string(), items: z.array(z.string()) })"
         Use z.any() for fields you don't care about, z.optional() for nullable fields
      5. Use verifyData with expect() assertions to check specific values
         Example: "expect(data.name).toBe('Test Suite')"
         Example: "expect(data.items).toHaveLength(3)"
         Example: "expect(data.status).not.toBe('deleted')"
      6. Use record to document findings and observations
      7. Use finish when all test goals are achieved and verified
      8. Use stop only if the scenario cannot be completed at all
      </approach>

      <rules>
      - Always check HTTP status codes from the request tool result
      - After each request, verify structure with a Zod schema matching the API spec
      - Use verifyData with expect() for value assertions — data is the parsed response JSON
      - For CRUD tests: create first, extract ID from preview, then read/update/delete
      - Chain requests logically — extract IDs from response preview
      - Record important findings as you go
      - Be precise about what you expect vs what you observe
      - If a test requires data from another endpoint, use schemaFor to look it up before guessing
      </rules>
    `;
  }
}
