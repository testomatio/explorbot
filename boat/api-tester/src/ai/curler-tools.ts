import { tool } from 'ai';
const { expect } = require('expect');
import { readFileSync } from 'node:fs';
import dedent from 'dedent';
import { z } from 'zod';
import type { Test, TestResultType } from '../../../../src/test-plan.ts';
import { TestResult } from '../../../../src/test-plan.ts';
import { tag } from '../../../../src/utils/logger.ts';
import type { ApiClient } from '../api-client.ts';
import type { RequestStore } from '../../../../src/api/request-store.ts';

const readResponseData = (responseFile: string) => {
  return JSON.parse(readFileSync(responseFile, 'utf8'));
};

function summarizeStructure(value: unknown, depth = 0): string {
  if (depth > 2) return '...';
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `[${summarizeStructure(value[0], depth + 1)}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.keys(value).slice(0, 10);
    const parts = entries.map((k) => `${k}: ${summarizeStructure((value as any)[k], depth + 1)}`);
    if (Object.keys(value).length > 10) parts.push('...');
    return `{ ${parts.join(', ')} }`;
  }
  return typeof value;
}

export function createCurlerTools(apiClient: ApiClient, requestState: RequestStore, test: Test, searchSpec?: (query: string) => string) {
  const commitVerification = (label: string, passed: boolean, failDetail: string) => {
    const activeNote = test.startNote(label);
    if (passed) {
      tag('success').log(`${label} passed`);
      activeNote.commit(TestResult.PASSED);
    } else {
      tag('warning').log(`${label} failed — ${failDetail}`);
      activeNote.commit(TestResult.FAILED);
    }
  };

  return {
    request: tool({
      description: dedent`
        Make an HTTP request to the API endpoint.
        Returns status, timing, and a preview of the response body (first 500 chars).
        Full response is saved to responseFile — use verifyStructure and verifyData to check it.
      `,
      inputSchema: z.object({
        method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']).describe('HTTP method'),
        path: z.string().describe('API path (e.g., /users, /users/1)'),
        headers: z.record(z.string(), z.string()).optional().describe('Additional headers'),
        body: z.any().optional().describe('Request body (JSON object or string)'),
        queryParams: z.record(z.string(), z.string()).optional().describe('Query parameters'),
      }),
      execute: async (input) => {
        tag('step').log(`${input.method} ${input.path}`);
        const activeNote = test.startNote(`${input.method} ${input.path}`);

        const result = await apiClient.request({
          method: input.method,
          path: input.path,
          headers: input.headers,
          body: input.body,
          queryParams: input.queryParams,
        });

        requestState.addRequest(result);

        if (result.error) {
          tag('error').log(`${input.method} ${input.path} > Network error: ${result.error}`);
          activeNote.commit(TestResult.FAILED);
          return {
            success: false,
            error: result.error,
            curlCommand: result.toCurlCommand(),
          };
        }

        const statusLine = `${result.status} ${result.statusText}`;
        const bodyString = input.body ? (typeof input.body === 'string' ? input.body : JSON.stringify(input.body, null, 2)) : undefined;
        test.addStep(`${input.method} ${input.path} > ${statusLine} (${result.timing}ms)`, result.timing, undefined, undefined, bodyString, [result.responseFile]);

        if (result.status >= 400) {
          tag('error').log(`${input.method} ${input.path} > ${statusLine} (${result.timing}ms)`);
          activeNote.commit(TestResult.FAILED);
        } else {
          tag('success').log(`${input.method} ${input.path} > ${statusLine} (${result.timing}ms)`);
          activeNote.commit(TestResult.PASSED);
        }

        if (bodyString) {
          tag('multiline').log(`Request body:\n${bodyString}`);
        }
        tag('multiline').log(`Response body:\n${result.rawResponseBody}`);

        return {
          success: true,
          status: result.status,
          statusText: result.statusText,
          timing: result.timing,
          responsePreview: result.rawResponseBody.substring(0, 500),
          responseFile: result.responseFile,
          curlCommand: result.toCurlCommand(),
        };
      },
    }),

    ...(searchSpec
      ? {
          schemaFor: tool({
            description: dedent`
              Search the API spec for endpoints matching a keyword.
              Returns endpoint paths, HTTP methods, and schema definitions.
              Use to discover related endpoints when you need to set up test data or find dependencies.
              Pass "*" to list all available endpoints (paths and methods only).
            `,
            inputSchema: z.object({
              query: z.string().describe('Keyword to search for in endpoint paths (e.g., "comments", "users"). Use "*" to list all endpoints.'),
            }),
            execute: async ({ query }) => {
              tag('step').log(`Schema lookup: ${query}`);
              return { result: searchSpec(query) };
            },
          }),
        }
      : {}),

    verifyStructure: tool({
      description: dedent`
        Verify response JSON structure using a Zod schema.
        Write a JS expression that returns a Zod schema (z is available).
        Example schema: "z.object({ id: z.number(), name: z.string(), items: z.array(z.object({ title: z.string() })) })"
        Returns validation errors if the response doesn't match.
        On success, returns a "structure" field showing the actual response shape — use it to write correct verifyData assertions.
      `,
      inputSchema: z.object({
        responseFile: z.string().describe('Path to the response JSON file'),
        schema: z.string().describe('JS expression returning a Zod schema, e.g. "z.object({ id: z.number(), name: z.string() })"'),
      }),
      execute: async ({ responseFile, schema: schemaCode }) => {
        let data: unknown;
        try {
          data = readResponseData(responseFile);
        } catch (e: any) {
          commitVerification('Structure check: failed to read response', false, e.message);
          return { passed: false, errors: [e.message] };
        }

        try {
          const schemaObj = new Function('z', `return ${schemaCode}`)(z);
          const result = schemaObj.safeParse(data);

          if (result.success) {
            commitVerification('Structure check: ✓ schema valid', true, '');
            const structure = summarizeStructure(data);
            return { passed: true, errors: [], structure };
          }

          const errors = result.error.issues.map((i: any) => `${i.path.join('.')}: ${i.message}`);
          commitVerification(`Structure check: ✗ ${errors.join(', ')}`, false, errors.join('; '));
          return { passed: false, errors };
        } catch (e: any) {
          commitVerification(`Structure check: schema error — ${e.message}`, false, e.message);
          return { passed: false, errors: [e.message] };
        }
      },
    }),

    verifyData: tool({
      description: dedent`
        Verify specific values in the response JSON using expect() assertions.
        Each assertion is a JS expression with "response" (full parsed JSON body) and "expect" (Jest expect) available.
        "response" is the entire parsed JSON — access nested fields accordingly.
        Example assertions:
        - "expect(response.name).toBe('Test Suite')"
        - "expect(response.items).toHaveLength(3)"
        - "expect(response).toHaveProperty('id')"
        - "expect(response.count).toBeGreaterThan(0)"
        - "expect(response.data.tags).toContain('urgent')"
        - "expect(response).toMatchObject({ status: 'active' })"
      `,
      inputSchema: z.object({
        responseFile: z.string().describe('Path to the response JSON file'),
        assertions: z.array(z.string()).describe('JS expressions using expect(response) — e.g. "expect(response.id).toBe(1)"'),
      }),
      execute: async ({ responseFile, assertions }) => {
        let response: unknown;
        try {
          response = readResponseData(responseFile);
        } catch (e: any) {
          commitVerification('Data check: failed to read response', false, e.message);
          return { passed: false, results: [{ code: '<read file>', passed: false, error: e.message }] };
        }

        const results: Array<{ code: string; passed: boolean; error?: string }> = [];
        for (const code of assertions) {
          try {
            new Function('expect', 'response', code)(expect, response);
            results.push({ code, passed: true });
          } catch (e: any) {
            results.push({ code, passed: false, error: e.message });
          }
        }

        const passed = results.every((r) => r.passed);
        const okResults = results.filter((r) => r.passed);
        const failedResults = results.filter((r) => !r.passed);
        let label = 'Data check:';
        if (okResults.length > 0) label += ` ✓ ${okResults.map((r) => r.code).join(', ')}`;
        if (failedResults.length > 0) label += ` ✗ ${failedResults.map((f) => `${f.code}: ${f.error}`).join(', ')}`;

        commitVerification(label, passed, failedResults.map((f) => `${f.code}: ${f.error}`).join('; '));

        return { passed, results };
      },
    }),

    record: tool({
      description: dedent`
        Record a note or observation during testing.
        Use status "success" for achieved outcomes, "fail" for failures.
      `,
      inputSchema: z.object({
        note: z.string().describe('Observation or finding'),
        status: z.enum(['success', 'fail']).optional().describe('Outcome status'),
      }),
      execute: async ({ note, status }) => {
        let mappedStatus: TestResultType = null;
        if (status === 'success') mappedStatus = TestResult.PASSED;
        else if (status === 'fail') mappedStatus = TestResult.FAILED;

        test.addNote(note, mappedStatus);

        if (status === 'success') {
          tag('success').log(`${note}`);
        } else if (status === 'fail') {
          tag('warning').log(`${note}`);
        }

        return { recorded: true };
      },
    }),

    finish: tool({
      description: dedent`
        Mark the test as complete. Use when all test goals are achieved.
      `,
      inputSchema: z.object({
        summary: z.string().describe('Summary of what was tested and results'),
      }),
      execute: async ({ summary }) => {
        test.summary = summary;
        test.addNote(`Test complete: ${summary}`, TestResult.PASSED);
        test.finish(TestResult.PASSED);
        tag('success').log(`Test finished: ${summary}`);
        return { finished: true };
      },
    }),

    stop: tool({
      description: dedent`
        Abort the test. Use when the scenario cannot be completed.
      `,
      inputSchema: z.object({
        reason: z.string().describe('Why the test cannot continue'),
      }),
      execute: async ({ reason }) => {
        test.summary = `Test stopped: ${reason}`;
        test.addNote(`Test stopped: ${reason}`, TestResult.FAILED);
        test.finish(TestResult.FAILED);
        tag('warning').log(`Test stopped: ${reason}`);
        return { stopped: true };
      },
    }),
  };
}
