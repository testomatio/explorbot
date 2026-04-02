import { RequestResult, generateRequestId, resetRequestCounter } from './request-result.ts';

export class ApiClient {
  private baseEndpoint: string;
  private defaultHeaders: Record<string, string>;

  constructor(baseEndpoint: string, defaultHeaders: Record<string, string> = {}) {
    this.baseEndpoint = baseEndpoint.replace(/\/$/, '');
    this.defaultHeaders = defaultHeaders;
  }

  setHeaders(headers: Record<string, string>): void {
    Object.assign(this.defaultHeaders, headers);
  }

  getHeaders(): Record<string, string> {
    return { ...this.defaultHeaders };
  }

  getBaseEndpoint(): string {
    return this.baseEndpoint;
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

    try {
      const response = await fetch(fullUrl, fetchOptions);
      const rawBody = await response.text();
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
      });
      result.rawResponseBodyValue = rawBody;
      return result;
    } catch (err: any) {
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
        error: err.message || String(err),
      });
      result.rawResponseBodyValue = '';
      return result;
    }
  }

  static resetCounter(): void {
    resetRequestCounter();
  }
}
