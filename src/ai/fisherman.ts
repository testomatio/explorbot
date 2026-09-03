import dedent from 'dedent';
import type { ApiClient } from '../api/api-client.ts';
import { type EndpointFamily, type RequestStore, isFailedRequest } from '../api/request-store.ts';
import { listAllEndpoints } from '../api/spec-reader.ts';
import { createDebug, tag } from '../utils/logger.ts';

const debugLog = createDebug('explorbot:fisherman');
import { loop } from '../utils/loop.ts';
import type { Agent } from './agent.ts';
import type { Conversation } from './conversation.ts';
import { type FishermanResult, createFishermanTools } from './fisherman-tools.ts';
import { RequestHaul } from './fisherman/request-haul.ts';
import type { Provider } from './provider.ts';
import { dataProtectionRules } from './rules.ts';

const MAX_ITERATIONS = 15;
const MAX_TOOL_ROUNDTRIPS = 5;
const REPEATED_FAILURE_LIMIT = 4;

export class Fisherman implements Agent {
  emoji = '🎣';
  private provider: Provider;
  private apiClient: ApiClient;
  private requestStore: RequestStore;
  private specLoader: () => Promise<any | null>;
  private browserHeaderProvider: () => Promise<Record<string, string>>;
  private configHeaders: Record<string, string>;
  private sessionName?: string;
  private baseEndpoint: string;
  private spec: any | null = null;
  private mode: 'replicate' | 'achieve' | 'disabled' = 'disabled';
  private hasApiConfig: boolean;
  private scopeDegraded = false;

  constructor(provider: Provider, apiClient: ApiClient, requestStore: RequestStore, specLoader: () => Promise<any | null>, baseEndpoint: string, browserHeaderProvider: () => Promise<Record<string, string>>, configHeaders: Record<string, string> = {}, hasApiConfig = false) {
    this.provider = provider;
    this.apiClient = apiClient;
    this.requestStore = requestStore;
    this.specLoader = specLoader;
    this.baseEndpoint = baseEndpoint;
    this.browserHeaderProvider = browserHeaderProvider;
    this.configHeaders = configHeaders;
    this.hasApiConfig = hasApiConfig;
    this.mode = hasApiConfig ? 'achieve' : 'replicate';
  }

  isAvailable(): boolean {
    return this.mode !== 'disabled';
  }

  async ensureReady(scopeUrl?: string): Promise<void> {
    await this.detectMode(scopeUrl);
    this.spec ??= await this.specLoader();
    debugLog(`ensureReady: mode=${this.mode}, scope=${scopeUrl}`);
  }

  getEndpointList(scopeUrl?: string): string {
    return this.buildEndpointList(scopeUrl);
  }

  async prepareData(instructions: string, scopeUrl?: string, sessionName?: string): Promise<FishermanResult> {
    this.sessionName = sessionName;
    tag('info').log(`Fisherman [${this.mode}]: preparing data — ${instructions}`);

    await this.ensureReady(scopeUrl);

    if (this.mode === 'disabled') {
      debugLog('disabled — no data for scope');
      return { success: false, summary: 'No API data available for this scope', created: [], failed: [] };
    }

    const endpointList = this.buildEndpointList(scopeUrl);
    debugLog(`endpoints:\n${endpointList || '(none)'}`);

    if (!endpointList) {
      tag('warning').log('Fisherman: no endpoints available');
      return { success: false, summary: 'No API endpoints available', created: [], failed: [] };
    }

    await this.refreshAuth();
    debugLog(`auth headers: ${Object.keys(this.apiClient.getHeaders()).join(', ')}`);

    const haul = new RequestHaul(this.requestStore);
    const { tools, getResult, isFinished, finishFromText } = createFishermanTools(this.apiClient, this.requestStore, haul, {
      spec: this.spec,
      baseEndpoint: this.baseEndpoint,
    });

    const conversation = this.provider.startConversation(this.buildSystemPrompt(endpointList, Object.keys(tools), scopeUrl), 'fisherman');
    conversation.addUserText(this.buildTaskPrompt(instructions));

    await this.runSession(conversation, tools, { haul, isFinished, finishFromText, label: `fisherman: ${instructions.slice(0, 50)}` });

    const result = getResult();
    tag('info').log(`Fisherman result: ${result.summary}`);
    return result;
  }

  async lookupData(question: string, scopeUrl?: string, sessionName?: string): Promise<FishermanResult> {
    this.sessionName = sessionName;
    tag('info').log(`Fisherman [read]: ${question}`);

    await this.ensureReady(scopeUrl);

    if (this.mode === 'disabled') {
      debugLog('disabled — no data for scope');
      return { success: false, summary: 'No API data available for this scope', created: [], failed: [] };
    }

    const endpointList = this.buildEndpointList(scopeUrl, 'read');
    debugLog(`read endpoints:\n${endpointList || '(none)'}`);

    if (!endpointList) {
      tag('warning').log('Fisherman: no read endpoints available');
      return { success: false, summary: 'No read endpoints are known for this scope', created: [], failed: [] };
    }

    await this.refreshAuth();

    const haul = new RequestHaul(this.requestStore);
    const { tools, getResult, isFinished, finishFromText } = createFishermanTools(this.apiClient, this.requestStore, haul, {
      spec: this.spec,
      baseEndpoint: this.baseEndpoint,
      readOnly: true,
    });

    const conversation = this.provider.startConversation(this.buildLookupSystemPrompt(endpointList, Object.keys(tools), scopeUrl), 'fisherman');
    conversation.addUserText(dedent`
      Answer this question about data that already exists:

      ${question}

      Make the requests needed to answer it, then call finish with the answer.
      If the available endpoints cannot answer it, call stop with the reason.
    `);

    await this.runSession(conversation, tools, { haul, isFinished, finishFromText, label: `fisherman lookup: ${question.slice(0, 50)}` });

    const result = getResult();
    tag('info').log(`Fisherman answer: ${result.summary}`);
    return result;
  }

  private async runSession(conversation: Conversation, tools: Record<string, any>, opts: { haul: RequestHaul; isFinished: () => boolean; finishFromText: (text?: string) => void; label: string }): Promise<void> {
    await loop(
      async ({ stop, iteration }) => {
        debugLog(`iteration ${iteration}`);
        const invokeResult = await this.provider.invokeConversation(conversation, tools, {
          maxToolRoundtrips: MAX_TOOL_ROUNDTRIPS,
          agentName: 'fisherman',
        });
        debugLog(`iteration ${iteration} done, text: ${invokeResult?.response?.text?.slice(0, 200) || '(none)'}`);

        if (opts.isFinished()) {
          stop();
          return;
        }

        if (!invokeResult?.toolExecutions?.length) {
          debugLog('no tool call in this turn — treating as finish');
          opts.finishFromText(invokeResult?.response?.text);
          stop();
          return;
        }

        if (this.isStuckOnEndpoint(opts.haul)) {
          tag('warning').log('Fisherman: repeated failures on the same endpoint — stopping');
          stop();
          return;
        }

        if (iteration >= MAX_ITERATIONS) {
          tag('warning').log('Fisherman: max iterations reached');
          stop();
        }
      },
      {
        maxAttempts: MAX_ITERATIONS,
        observability: {
          name: opts.label,
          agent: 'fisherman',
          sessionId: this.sessionName,
        },
        catch: async ({ error, stop }) => {
          debugLog(`error: ${error.message}`);
          tag('warning').log(`Fisherman error: ${error.message}`);
          stop();
        },
      }
    );
  }

  private async detectMode(scopeUrl?: string): Promise<void> {
    if (this.hasApiConfig) {
      this.mode = 'achieve';
      debugLog('achieve mode — api config present');
      return;
    }

    this.requestStore.loadFromDisk();
    const allRequests = this.requestStore.getCapturedRequests();
    debugLog(`total stored requests: ${allRequests.length}, scope: ${scopeUrl}`);

    if (allRequests.length > 0) {
      this.mode = 'replicate';
      return;
    }

    this.mode = 'disabled';
  }

  private async refreshAuth(): Promise<void> {
    if (this.mode === 'replicate') {
      const xhrHeaders = this.requestStore.extractAuthHeaders();
      if (Object.keys(xhrHeaders).length > 0) {
        this.apiClient.setHeaders(xhrHeaders);
      }

      const browserHeaders = await this.browserHeaderProvider();
      if (Object.keys(browserHeaders).length > 0) {
        this.apiClient.setHeaders(browserHeaders);
      }
    }

    if (Object.keys(this.configHeaders).length > 0) {
      this.apiClient.setHeaders(this.configHeaders);
    }
  }

  private buildEndpointList(scopeUrl?: string, family: EndpointFamily = 'write'): string {
    this.scopeDegraded = false;
    if (this.mode === 'achieve' && this.spec) {
      let specEndpoints = listAllEndpoints(this.spec, this.baseEndpoint);
      if (family === 'read') specEndpoints = keepReadLines(specEndpoints);
      if (specEndpoints) return specEndpoints;
    }

    const scoped = this.requestStore.toEndpointList(scopeUrl || '/', family);
    if (scoped) return scoped;

    this.scopeDegraded = true;
    return this.requestStore.toEndpointList(undefined, family);
  }

  private buildSystemPrompt(endpointList: string, toolNames: string[], scopeUrl?: string): string {
    let scopeBlock = '';
    if (scopeUrl) {
      scopeBlock = `\n\nSCOPE: You are operating within ${scopeUrl}.\nAll created items must belong to this scope.`;
      if (this.scopeDegraded) scopeBlock += '\nThe endpoint list could not be narrowed to this scope and may include endpoints belonging to other scopes. Before writing, confirm the target belongs to this scope.';
    }

    return dedent`
      You are Fisherman — a data preparation agent. You create test data by making API requests.

      AVAILABLE ENDPOINTS:
      ${endpointList}
      ${scopeBlock}

      AVAILABLE TOOLS:
      ${toolNames.join(', ')}.
      Use tool names exactly as listed. Do not invent aliases or combined names.
      Match each tool input schema exactly. Do not invent parameter names or pass extra fields.

      WORKFLOW:
      1. Call getEndpointSpec to see the request body example for the endpoint
      2. Make requests — the response automatically extracts IDs, names, and status fields
      3. Use extracted IDs to chain requests (e.g., create suite, use its id to create tests in it)
      4. Call finish with a summary and IDs of all created items

      RULES:
      - Always call getEndpointSpec before your first request to an unfamiliar endpoint
      - Chain requests logically — create parent resources before children
      - Use the response category and error text to decide what failed: validation requires corrected data, authorization requires valid access, not_found requires a valid path or parent, and conflict requires resolving the conflicting state
      - Retry temporary or server failures once. Retry other failures only when the specification or error text gives a concrete correction
      - Create only the resource types that were requested. If no endpoint creates a requested type, call stop — never create a different type as a substitute
      - Use realistic but unique data for each item (vary names, titles)

      ${dataProtectionRules}
    `;
  }

  private buildLookupSystemPrompt(endpointList: string, toolNames: string[], scopeUrl?: string): string {
    let scopeBlock = '';
    if (scopeUrl) {
      scopeBlock = `\n\nSCOPE: You are answering about ${scopeUrl}.`;
      if (this.scopeDegraded) scopeBlock += '\nThe endpoint list could not be narrowed to this scope and may include endpoints belonging to other scopes. Prefer the endpoint whose path belongs to this scope.';
    }

    return dedent`
      You are Fisherman — reading the API to report what data already exists. You change nothing.

      AVAILABLE ENDPOINTS:
      ${endpointList}
      ${scopeBlock}

      AVAILABLE TOOLS:
      ${toolNames.join(', ')}.
      Use tool names exactly as listed. Do not invent aliases or combined names.
      Match each tool input schema exactly. Do not invent parameter names or pass extra fields.

      WORKFLOW:
      1. Pick the endpoint that lists the kind of item the question is about
      2. Request it, and when the answer needs a parent resource, request the parent first and use its id
      3. Call finish with the answer, quoting the concrete names, titles and ids the responses returned

      RULES:
      - Report only what a response actually returned. Never describe data you did not read
      - Report an empty collection as empty. An absent item must not be reported as present
      - Answer the question that was asked and stop. Do not survey unrelated endpoints
      - Use the response category and error text to correct a failed request. Retry a temporary or server failure once
    `;
  }

  private isStuckOnEndpoint(haul: RequestHaul): boolean {
    const made = haul.requests();
    if (made.length < REPEATED_FAILURE_LIMIT) return false;
    const recent = made.slice(-REPEATED_FAILURE_LIMIT);
    const first = recent[0];
    return recent.every((r) => isFailedRequest(r) && r.method === first.method && r.path === first.path);
  }

  private buildTaskPrompt(instructions: string): string {
    return dedent`
      Prepare the following test data:

      ${instructions}

      ${dataProtectionRules}

      If data preparation is allowed by these rules, execute the necessary API requests to create this data.
      When done, call finish with the summary. If data preparation is forbidden, call stop with the reason.
    `;
  }
}

function keepReadLines(endpointList: string): string {
  return endpointList
    .split('\n')
    .filter((line) => line.startsWith('GET '))
    .join('\n');
}
