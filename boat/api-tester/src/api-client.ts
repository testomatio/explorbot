import type { HookFn } from './config.ts';
import { RequestResult } from './request-result.ts';

let requestCounter = 0;

function generateRequestId(method: string, urlPath: string): string {
  requestCounter++;
  const num = String(requestCounter).padStart(3, '0');
  const sanitized = urlPath
    .replace(/^\//, '')
    .replace(/[^a-zA-Z0-9]/g, '_')
    .slice(0, 50);
  return `${num}_${method}_${sanitized}`;
}

export class ApiClient {
  private baseEndpoint: string;
  private defaultHeaders: Record<string, string>;
  private bootstrapHook?: HookFn;
  private teardownHook?: HookFn;

  constructor(baseEndpoint: string, defaultHeaders: Record<string, string> = {}, hooks?: { bootstrap?: HookFn; teardown?: HookFn }) {
    this.baseEndpoint = baseEndpoint.replace(/\/$/, '');
    this.defaultHeaders = defaultHeaders;
    this.bootstrapHook = hooks?.bootstrap;
    this.teardownHook = hooks?.teardown;
  }

  async bootstrap(): Promise<void> {
    if (!this.bootstrapHook) return;
    const ctx = { headers: { ...this.defaultHeaders }, baseEndpoint: this.baseEndpoint };
    const result = await this.bootstrapHook(ctx);
    if (result && typeof result === 'object') {
      Object.assign(this.defaultHeaders, result);
    }
  }

  async teardown(): Promise<void> {
    if (!this.teardownHook) return;
    const ctx = { headers: { ...this.defaultHeaders }, baseEndpoint: this.baseEndpoint };
    await this.teardownHook(ctx);
  }

  async request(opts: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: any;
    queryParams?: Record<string, string>;
  }): Promise<RequestResult> {
    const method = opts.method.toUpperCase();
    const urlPath = opts.path.startsWith('/') ? opts.path : `/${opts.path}`;
    let fullUrl = `${this.baseEndpoint}${urlPath}`;

    if (opts.queryParams && Object.keys(opts.queryParams).length > 0) {
      const params = new URLSearchParams(opts.queryParams);
      fullUrl += `?${params.toString()}`;
    }

    const headers: Record<string, string> = {
      ...this.defaultHeaders,
      ...opts.headers,
    };

    const fetchOptions: RequestInit = { method, headers };

    if (opts.body && !['GET', 'HEAD'].includes(method)) {
      if (typeof opts.body === 'string') {
        fetchOptions.body = opts.body;
      } else {
        fetchOptions.body = JSON.stringify(opts.body);
        if (!headers['Content-Type'] && !headers['content-type']) {
          headers['Content-Type'] = 'application/json';
        }
      }
    }

    const id = generateRequestId(method, urlPath);
    const start = performance.now();
    let response: Response;
    let rawBody = '';
    let error: string | undefined;

    try {
      response = await fetch(fullUrl, fetchOptions);
      rawBody = await response.text();
    } catch (err: any) {
      error = err.message || String(err);
      const result = new RequestResult({
        id,
        method,
        path: urlPath,
        fullUrl,
        requestHeaders: headers,
        requestBody: opts.body,
        status: 0,
        statusText: 'Network Error',
        responseHeaders: {},
        timing: Math.round(performance.now() - start),
        timestamp: new Date(),
        error,
      });
      result.rawResponseBodyValue = '';
      return result;
    }

    const timing = Math.round(performance.now() - start);
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    const result = new RequestResult({
      id,
      method,
      path: urlPath,
      fullUrl,
      requestHeaders: headers,
      requestBody: opts.body,
      status: response.status,
      statusText: response.statusText,
      responseHeaders,
      timing,
      timestamp: new Date(),
      error,
    });
    result.rawResponseBodyValue = rawBody;
    return result;
  }

  static resetCounter(): void {
    requestCounter = 0;
  }
}
