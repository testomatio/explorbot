import dedent from 'dedent';
import type { ApiClient } from '../api/api-client.ts';
import type { RequestStore } from '../api/request-store.ts';
import { listAllEndpoints } from '../api/spec-reader.ts';
import { createDebug, tag } from '../utils/logger.ts';

const debugLog = createDebug('explorbot:fisherman');
import { loop } from '../utils/loop.ts';
import type { Agent } from './agent.ts';
import { type FishermanResult, createFishermanTools } from './fisherman-tools.ts';
import type { Provider } from './provider.ts';

const MAX_ITERATIONS = 15;
const MAX_TOOL_ROUNDTRIPS = 5;

export class Fisherman implements Agent {
  emoji = '🎣';
  private provider: Provider;
  private apiClient: ApiClient;
  private requestStore: RequestStore;
  private specLoader: () => Promise<any | null>;
  private cookieProvider: () => Promise<Record<string, string>>;
  private configHeaders: Record<string, string>;
  private baseEndpoint: string;
  private spec: any | null = null;
  private mode: 'replicate' | 'achieve' | 'disabled' = 'disabled';
  private hasApiConfig: boolean;

  constructor(provider: Provider, apiClient: ApiClient, requestStore: RequestStore, specLoader: () => Promise<any | null>, baseEndpoint: string, cookieProvider: () => Promise<Record<string, string>>, configHeaders: Record<string, string> = {}, hasApiConfig = false) {
    this.provider = provider;
    this.apiClient = apiClient;
    this.requestStore = requestStore;
    this.specLoader = specLoader;
    this.baseEndpoint = baseEndpoint;
    this.cookieProvider = cookieProvider;
    this.configHeaders = configHeaders;
    this.hasApiConfig = hasApiConfig;
    this.mode = hasApiConfig ? 'achieve' : 'replicate';
  }

  isAvailable(): boolean {
    return this.mode !== 'disabled';
  }

  getMode(): string {
    return this.mode;
  }

  async prepareData(instructions: string, scopeUrl?: string): Promise<FishermanResult> {
    tag('info').log(`Fisherman [${this.mode}]: preparing data — ${instructions}`);

    await this.detectMode(scopeUrl);
    debugLog('mode: %s, scope: %s', this.mode, scopeUrl);

    if (this.mode === 'disabled') {
      debugLog('disabled — no data for scope');
      return { success: false, summary: 'No API data available for this scope', created: [], failed: [] };
    }

    this.spec ??= await this.specLoader();
    const endpointList = this.buildEndpointList(scopeUrl);
    debugLog('endpoints:\n%s', endpointList || '(none)');

    if (!endpointList) {
      tag('warning').log('Fisherman: no endpoints available');
      this.mode = 'disabled';
      return { success: false, summary: 'No API endpoints available', created: [], failed: [] };
    }

    await this.refreshAuth();
    debugLog('auth headers: %o', Object.keys(this.apiClient.getHeaders()));

    const { tools, getResult, isFinished } = createFishermanTools(this.apiClient, this.requestStore, {
      spec: this.spec,
      baseEndpoint: this.baseEndpoint,
    });

    const conversation = this.provider.startConversation(this.buildSystemPrompt(endpointList, scopeUrl), 'fisherman');
    conversation.addUserText(this.buildTaskPrompt(instructions));

    await loop(
      async ({ stop, iteration }) => {
        await this.provider.invokeConversation(conversation, tools, {
          maxToolRoundtrips: MAX_TOOL_ROUNDTRIPS,
          toolChoice: 'required',
          agentName: 'fisherman',
        });

        if (isFinished()) {
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
          name: `fisherman: ${instructions.slice(0, 50)}`,
          agent: 'fisherman',
        },
        catch: async ({ stop }) => {
          stop();
        },
      }
    );

    const result = getResult();
    tag('info').log(`Fisherman result: ${result.summary}`);
    return result;
  }

  private async detectMode(scopeUrl?: string): Promise<void> {
    if (this.hasApiConfig) {
      this.mode = 'achieve';
      debugLog('achieve mode — api config present');
      return;
    }

    this.requestStore.loadFromDisk();
    const allRequests = this.requestStore.getCapturedRequests();
    debugLog('total stored requests: %d, scope: %s', allRequests.length, scopeUrl);

    if (allRequests.length > 0) {
      this.mode = 'replicate';
      return;
    }

    this.mode = 'disabled';
  }

  private async refreshAuth(): Promise<void> {
    const cookies = await this.cookieProvider();
    if (Object.keys(cookies).length > 0) {
      this.apiClient.setHeaders(cookies);
    }

    const xhrHeaders = this.requestStore.extractAuthHeaders();
    if (Object.keys(xhrHeaders).length > 0) {
      this.apiClient.setHeaders(xhrHeaders);
    }

    if (Object.keys(this.configHeaders).length > 0) {
      this.apiClient.setHeaders(this.configHeaders);
    }
  }

  private buildEndpointList(scopeUrl?: string): string {
    if (this.mode === 'achieve' && this.spec) {
      const specEndpoints = listAllEndpoints(this.spec, this.baseEndpoint);
      if (specEndpoints) return specEndpoints;
    }

    const scope = scopeUrl || '/';
    const writeRequests = this.requestStore.getWriteRequestsForScope(scope);
    if (writeRequests.length === 0) return this.requestStore.toEndpointList();

    const seen = new Set<string>();
    const lines: string[] = [];

    for (const req of writeRequests) {
      const key = `${req.method} ${req.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(key);
    }

    return lines.join('\n');
  }

  private buildSystemPrompt(endpointList: string, scopeUrl?: string): string {
    const scopeBlock = scopeUrl ? `\n\nSCOPE: You are operating within ${scopeUrl}.\nAll created items must belong to this scope.` : '';

    return dedent`
      You are Fisherman — a data preparation agent. You create test data by making API requests.

      AVAILABLE ENDPOINTS:
      ${endpointList}
      ${scopeBlock}

      WORKFLOW:
      1. Review the task instructions
      2. For each item to create, call getEndpointSpec to learn the request format
      3. Make requests using the request tool
      4. Extract IDs from responses to chain requests (e.g., create suite first, then create tests in it using the suite ID)
      5. Call finish with a summary of all created items

      RULES:
      - Always call getEndpointSpec before your first request to an unfamiliar endpoint
      - Chain requests logically — create parent resources before children
      - If a request fails, try once more with adjusted data before reporting failure
      - Use realistic but unique data for each item (vary names, titles)
    `;
  }

  private buildTaskPrompt(instructions: string): string {
    return dedent`
      Prepare the following test data:

      ${instructions}

      Execute the necessary API requests to create this data. When done, call finish with the summary.
    `;
  }
}
