import { RequestResult, generateRequestId } from './request-result.ts';
import type { RequestStore } from './request-store.ts';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const JSON_CONTENT_TYPES = /application\/json|application\/.*\+json/i;

export class XhrCapture {
  private store: RequestStore;
  private baseOrigin: string;
  private handler: ((response: any) => Promise<void>) | null = null;

  constructor(store: RequestStore, baseUrl: string) {
    this.store = store;
    this.baseOrigin = new URL(baseUrl).origin;
  }

  attach(page: any): void {
    this.handler = async (response: any) => {
      try {
        await this.captureResponse(response);
      } catch {
        // ignore capture errors
      }
    };
    page.on('response', this.handler);
  }

  detach(page: any): void {
    if (!this.handler) return;
    page.off('response', this.handler);
    this.handler = null;
  }

  private async captureResponse(response: any): Promise<void> {
    const request = response.request();
    const resourceType = request.resourceType();

    if (resourceType !== 'xhr' && resourceType !== 'fetch') return;

    const method = request.method();
    const url = request.url();
    if (!url.startsWith(this.baseOrigin)) return;

    const status = response.status();

    if (status >= 400) {
      const failedUrl = new URL(url);
      const failure = new RequestResult({
        id: generateRequestId(method, failedUrl.pathname, 'fail_'),
        method,
        path: failedUrl.pathname,
        fullUrl: failedUrl.pathname + failedUrl.search,
        requestHeaders: {},
        status,
        statusText: response.statusText(),
        responseHeaders: {},
        timing: 0,
        timestamp: new Date(),
      });
      this.store.addFailedRequest(failure);
    }

    if (!WRITE_METHODS.has(method)) return;

    const contentType = response.headers()['content-type'] || '';
    if (!JSON_CONTENT_TYPES.test(contentType)) return;

    if (status === 304) return;

    const parsedUrl = new URL(url);
    const origin = parsedUrl.pathname + parsedUrl.search;
    const id = generateRequestId(method, parsedUrl.pathname, 'xhr_');

    const requestHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(request.headers())) {
      requestHeaders[k] = String(v);
    }

    const responseHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(response.headers())) {
      responseHeaders[k] = String(v);
    }

    let rawBody = '';
    try {
      rawBody = await response.text();
    } catch {
      return;
    }

    let requestBody: any;
    try {
      const postData = request.postData();
      if (postData) {
        requestBody = JSON.parse(postData);
      }
    } catch {
      requestBody = request.postData() || undefined;
    }

    const result = new RequestResult({
      id,
      method,
      path: parsedUrl.pathname,
      fullUrl: origin,
      requestHeaders,
      requestBody,
      status,
      statusText: response.statusText(),
      responseHeaders,
      timing: 0,
      timestamp: new Date(),
    });
    result.rawResponseBodyValue = rawBody;

    this.store.addCapturedRequest(result);
  }
}
