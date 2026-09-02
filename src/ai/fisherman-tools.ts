import { tool } from 'ai';
import dedent from 'dedent';
import { z } from 'zod';
import type { ApiClient } from '../api/api-client.ts';
import type { RequestResult } from '../api/request-result.ts';
import type { RequestStore } from '../api/request-store.ts';
import { extractEndpointDefinition } from '../api/spec-reader.ts';
import { tag } from '../utils/logger.ts';
import { RequestMap } from '../utils/request-map.ts';
import { isDynamicSegment } from '../utils/url-matcher.ts';

export function createFishermanTools(apiClient: ApiClient, requestStore: RequestStore, opts: { spec?: any; baseEndpoint?: string }) {
  let finished = false;
  let result: FishermanResult | null = null;
  const ledgerStart = requestStore.getMadeRequests().length;

  const runRequests = () => requestStore.getMadeRequests().slice(ledgerStart);
  const successfulWrites = () => runRequests().filter((r) => r.isWrite && !r.error && r.status >= 200 && r.status < 400);
  const getResult = () => result ?? synthesizeResult(runRequests(), successfulWrites(), false);
  const isFinished = () => finished;
  const finishFromText = (text?: string) => {
    finished = true;
    const synthesized = synthesizeResult(runRequests(), successfulWrites(), true);
    if (text && synthesized.success) synthesized.summary = text;
    result = synthesized;
  };

  const tools = {
    getEndpointSpec: tool({
      description: dedent`
        Get the request specification for an endpoint.
        Returns the request body example from a previously captured request, or OpenAPI spec definition.
        Call this before making a request to an endpoint you haven't used before.
      `,
      inputSchema: z.object({
        method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).describe('HTTP method'),
        path: z.string().describe('Endpoint path, e.g. /suites'),
      }),
      execute: async ({ method, path }) => {
        tag('step').log(`Fisherman: spec lookup ${method} ${path}`);

        let captured = requestStore.findCapturedRequest(method, path);
        if (captured && !captured.requestBody && opts.spec) captured = undefined;
        if (captured) {
          if (captured.status >= 400) {
            const rejectedCapture = {
              status: captured.status,
              requestBody: captured.requestBody || 'no body',
            };
            if (opts.spec) {
              try {
                const definition = extractEndpointDefinition(opts.spec, path, opts.baseEndpoint);
                return { source: 'spec', method, path, definition, rejectedCapture };
              } catch {
                return { source: 'captured', method, path, usable: false, rejectedRequestBody: captured.requestBody || 'no body', status: captured.status };
              }
            }
            return {
              source: 'captured',
              method: captured.method,
              path: captured.path,
              status: captured.status,
              usable: false,
              rejectedRequestBody: captured.requestBody || 'no body',
            };
          }
          return {
            source: 'captured',
            method: captured.method,
            path: captured.path,
            status: captured.status,
            requestBody: captured.requestBody || 'no body',
          };
        }

        if (opts.spec) {
          try {
            const definition = extractEndpointDefinition(opts.spec, path, opts.baseEndpoint);
            return { source: 'spec', definition };
          } catch (err: any) {
            return { source: 'none', error: err.message };
          }
        }

        return { source: 'none', error: `No spec found for ${method} ${path}` };
      },
    }),

    request: tool({
      description: dedent`
        Make an HTTP request to the API.
        Returns status, plus IDs and names auto-extracted from the response under 'extracted'.
      `,
      inputSchema: z.object({
        method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).describe('HTTP method'),
        path: z.string().describe('API path (e.g., /suites, /suites/1)'),
        body: z.any().optional().describe('Request body (JSON object)'),
        queryParams: z.record(z.string(), z.string()).optional().describe('Query parameters'),
      }),
      execute: async (input) => {
        tag('step').log(`Fisherman: ${input.method} ${input.path}`);

        const reqResult = await apiClient.request({
          method: input.method,
          path: input.path,
          body: input.body,
          queryParams: input.queryParams,
        });

        requestStore.addMadeRequest(reqResult);

        if (reqResult.error) {
          tag('error').log(`Fisherman: ${input.method} ${input.path} > Network error: ${reqResult.error}`);
          return { success: false, error: reqResult.error };
        }

        const statusLine = `${reqResult.status} ${reqResult.statusText}`;

        if (reqResult.status >= 400) {
          tag('error').log(`Fisherman: ${input.method} ${input.path} > ${statusLine}`);
          return {
            success: false,
            status: reqResult.status,
            statusText: reqResult.statusText,
            category: responseCategory(reqResult.status),
            errorPreview: reqResult.rawResponseBody.substring(0, 300),
          };
        }

        const extracted = extractKeyFields(reqResult.responseBody);
        tag('success').log(`Fisherman: ${input.method} ${input.path} > ${statusLine}`);
        return {
          success: true,
          status: reqResult.status,
          extracted,
        };
      },
    }),

    finish: tool({
      description: 'Report completion of data preparation. Call when all requested items have been created.',
      inputSchema: z.object({
        summary: z.string().describe('Summary of what was created'),
        created: z
          .array(
            z.object({
              type: z.string().describe('Item type (e.g., suite, test, label)'),
              id: z.union([z.string(), z.number()]).optional().describe('Created item ID'),
              title: z.string().optional().describe('Created item name/title'),
            })
          )
          .describe('List of successfully created items'),
        failed: z
          .array(
            z.object({
              type: z.string().describe('Item type that failed'),
              reason: z.string().describe('Why it failed'),
            })
          )
          .optional()
          .describe('List of items that could not be created'),
      }),
      execute: async ({ summary, created, failed }) => {
        const writes = successfulWrites();
        if (writes.length === 0) {
          tag('warning').log('Fisherman: finish rejected — no successful write request in this run');
          return { finished: false, error: 'No successful write request was made in this run, so nothing was created. Keep working, or call stop if the data cannot be prepared.' };
        }

        const createdRequests = new RequestMap(writes);

        const verified: FishermanResult['created'] = [];
        for (const item of created) {
          if (item.id === undefined) {
            verified.push(item);
            continue;
          }
          const request = createdRequests.get(item.id);
          if (!request) {
            tag('warning').log(`Fisherman: dropped unverified created item ${item.type} (id: ${item.id})`);
            continue;
          }
          verified.push({ ...item, request: request.toEndpoint() });
        }
        if (verified.length === 0) verified.push(...writes.map(toCreatedItem));

        tag('success').log(`Fisherman done: ${summary}`);
        finished = true;
        result = { success: true, summary, created: verified, failed: failed || [] };
        return { finished: true };
      },
    }),

    stop: tool({
      description: 'Abort data preparation when it cannot be completed.',
      inputSchema: z.object({
        reason: z.string().describe('Why preparation cannot continue'),
      }),
      execute: async ({ reason }) => {
        tag('warning').log(`Fisherman stopped: ${reason}`);
        finished = true;
        result = { success: false, summary: reason, created: [], failed: [] };
        return { stopped: true };
      },
    }),
  };

  return { tools, getResult, isFinished, finishFromText };
}

function synthesizeResult(made: RequestResult[], writes: RequestResult[], declaredDone: boolean): FishermanResult {
  const failures = made.filter((r) => r.status >= 400 || r.error);
  let summary = `Stopped before finishing: ${made.length} requests, ${writes.length} successful writes, ${failures.length} failed`;
  const lastFailure = failures[failures.length - 1];
  if (lastFailure) summary += `; last failure: ${lastFailure.toSummary()}`;
  return { success: declaredDone && writes.length > 0, summary, created: writes.map(toCreatedItem), failed: [] };
}

function toCreatedItem(write: RequestResult): FishermanResult['created'][number] {
  const { id, title } = write.extractIdAndTitle();
  const segments = write.path.split('/').filter((s) => s && !isDynamicSegment(s));
  return { type: segments[segments.length - 1] || 'item', id, title, request: write.toEndpoint() };
}

function responseCategory(status: number): ResponseCategory {
  if (status === 400 || status === 422) return 'validation';
  if (status === 401 || status === 403) return 'authorization';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 408 || status === 425 || status === 429) return 'temporary';
  if (status >= 500) return 'server';
  return 'client';
}

function extractKeyFields(body: any, result: Record<string, any> = {}, depth = 0): Record<string, any> {
  if (!body || typeof body !== 'object' || depth > 5) return result;

  if (Array.isArray(body)) {
    if (body.length > 0) extractKeyFields(body[0], result, depth + 1);
    return result;
  }

  for (const [key, value] of Object.entries(body)) {
    if (value == null) continue;
    if (typeof value === 'object') {
      extractKeyFields(value, result, depth + 1);
      continue;
    }
    if (key === 'id' || key === '_id' || key === 'uuid' || key.endsWith('_id')) {
      result[key] ??= value;
    }
    if (key === 'name' || key === 'title' || key === 'status') {
      result[key] ??= String(value).slice(0, 100);
    }
  }
  return result;
}

export interface FishermanResult {
  success: boolean;
  summary: string;
  created: Array<{ type: string; id?: string | number; title?: string; request?: string }>;
  failed: Array<{ type: string; reason: string }>;
}

type ResponseCategory = 'validation' | 'authorization' | 'not_found' | 'conflict' | 'temporary' | 'server' | 'client';
