import { ApiClient as BaseApiClient } from '../../../src/api/api-client.ts';
import type { RequestResult } from '../../../src/api/request-result.ts';
import { extractStatePath, matchesUrl } from '../../../src/utils/url-matcher.ts';
import type { HookFn } from './config.ts';

const BODY_METHODS = ['POST', 'PUT', 'PATCH'];

export class ApiClient extends BaseApiClient {
  private bootstrapHook?: HookFn;
  private teardownHook?: HookFn;
  private requestDefaults: RequestDefaults[] = [];

  constructor(baseEndpoint: string, defaultHeaders: Record<string, string> = {}, hooks?: { bootstrap?: HookFn; teardown?: HookFn }) {
    super(baseEndpoint, defaultHeaders);
    this.bootstrapHook = hooks?.bootstrap;
    this.teardownHook = hooks?.teardown;
  }

  async bootstrap(): Promise<void> {
    if (!this.bootstrapHook) return;
    const ctx = { headers: this.getHeaders(), baseEndpoint: this.getBaseEndpoint() };
    const result = await this.bootstrapHook(ctx);
    if (result && typeof result === 'object') {
      this.setHeaders(result);
    }
  }

  async teardown(): Promise<void> {
    if (!this.teardownHook) return;
    const ctx = { headers: this.getHeaders(), baseEndpoint: this.getBaseEndpoint() };
    await this.teardownHook(ctx);
  }

  addRequestDefaults(defaults: RequestDefaults): void {
    this.requestDefaults.push(defaults);
  }

  override async request(opts: Parameters<BaseApiClient['request']>[0]): Promise<RequestResult> {
    const path = extractStatePath(opts.path);
    const matching = this.requestDefaults.filter((defaults) => matchesUrl(defaults.pattern, path));
    if (!matching.length) return super.request(opts);

    const knowledgeHeaders: Record<string, string> = {};
    for (const defaults of matching) {
      for (const [name, value] of Object.entries(defaults.headers)) knowledgeHeaders[name.toLowerCase()] = value;
    }
    for (const name of Object.keys({ ...this.getHeaders(), ...opts.headers })) delete knowledgeHeaders[name.toLowerCase()];

    const headers = { ...knowledgeHeaders, ...this.getHeaders(), ...opts.headers };
    const queryParams = Object.assign({}, ...matching.map((defaults) => defaults.query), opts.queryParams);
    let body = opts.body;
    if (BODY_METHODS.includes(opts.method.toUpperCase()) && body && typeof body === 'object' && !Array.isArray(body)) {
      body = Object.assign({}, ...matching.map((defaults) => defaults.body), body);
    }

    return super.request({ ...opts, headers, queryParams, body });
  }
}

export interface RequestDefaults {
  pattern: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  body: Record<string, unknown>;
}
