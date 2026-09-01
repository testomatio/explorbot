import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { generalizeUrl, isDynamicSegment } from '../utils/url-matcher.ts';
import { RequestResult } from './request-result.ts';

const AUTH_HEADERS = ['authorization', 'x-api-key', 'x-csrf-token'];

export class RequestStore {
  private capturedRequests: RequestResult[] = [];
  private madeRequests: RequestResult[] = [];
  private failedRequests: RequestResult[] = [];
  private onFailedListeners: Array<(r: RequestResult) => void> = [];
  private outputDir: string;
  private sessionStartedAt = new Date();

  constructor(outputDir: string) {
    this.outputDir = outputDir;
  }

  addCapturedRequest(result: RequestResult): void {
    this.capturedRequests.push(result);
    result.save(this.outputDir);
  }

  addFailedRequest(result: RequestResult): void {
    this.failedRequests.push(result);
    for (const cb of this.onFailedListeners) {
      cb(result);
    }
  }

  getFailedRequests(): RequestResult[] {
    return this.failedRequests;
  }

  onFailedRequest(cb: (r: RequestResult) => void): () => void {
    this.onFailedListeners.push(cb);
    return () => {
      const idx = this.onFailedListeners.indexOf(cb);
      if (idx !== -1) this.onFailedListeners.splice(idx, 1);
    };
  }

  addMadeRequest(result: RequestResult): void {
    this.madeRequests.push(result);
    result.save(this.outputDir);
  }

  addRequest(result: RequestResult): void {
    this.addMadeRequest(result);
  }

  getCapturedRequests(): RequestResult[] {
    return this.capturedRequests;
  }

  getMadeRequests(): RequestResult[] {
    return this.madeRequests;
  }

  getRequests(): RequestResult[] {
    return this.madeRequests;
  }

  getLastRequest(): RequestResult | undefined {
    return this.madeRequests[this.madeRequests.length - 1];
  }

  getRequestsByEndpoint(pathPrefix: string): RequestResult[] {
    return this.madeRequests.filter((r) => r.path.startsWith(pathPrefix));
  }

  getRequestsByMethod(method: string): RequestResult[] {
    const upper = method.toUpperCase();
    return this.madeRequests.filter((r) => r.method === upper);
  }

  getRequestsByStatus(status: number): RequestResult[] {
    return this.madeRequests.filter((r) => r.status === status);
  }

  toEndpointList(scopePath?: string): string {
    let requests = this.capturedRequests;
    if (scopePath) requests = this.getWriteRequestsForScope(scopePath);

    const seen = new Set<string>();
    const lines: string[] = [];

    for (const req of requests) {
      const key = `${req.method} ${generalizeUrl(req.path, () => '{id}')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(key);
    }

    return lines.join('\n');
  }

  extractAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    const sessionCaptures = this.capturedRequests.filter((r) => r.timestamp >= this.sessionStartedAt).sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    for (const req of sessionCaptures) {
      for (const [key, value] of Object.entries(req.requestHeaders)) {
        if (AUTH_HEADERS.includes(key.toLowerCase()) && !headers[key]) {
          headers[key] = value;
        }
      }
    }

    return headers;
  }

  findCapturedRequest(method: string, searchPath: string): RequestResult | undefined {
    const upper = method.toUpperCase();
    const search = generalizeUrl(searchPath, () => '{id}').split('/').filter(Boolean);

    let best: RequestResult | undefined;
    let bestScore = -1;

    for (const req of this.capturedRequests) {
      if (req.method !== upper) continue;
      const segments = generalizeUrl(req.path, () => '{id}').split('/').filter(Boolean);
      if (segments.length < search.length) continue;
      if (!search.every((segment, i) => segment === segments[i])) continue;

      let score = 0;
      if (segments.length === search.length) score += 4;
      if (req.status < 400) score += 2;
      if (score < bestScore) continue;
      if (score === bestScore && best && req.timestamp <= best.timestamp) continue;
      best = req;
      bestScore = score;
    }

    return best;
  }

  toLog(): string {
    return this.madeRequests.map((r, i) => `${i + 1}. ${r.toSummary()} [${r.id}]`).join('\n');
  }

  loadFromDisk(): void {
    const requestsDir = path.join(this.outputDir, 'requests');
    if (!existsSync(requestsDir)) return;

    const existingIds = new Set(this.capturedRequests.map((r) => r.id));
    const files = readdirSync(requestsDir).filter((f) => f.startsWith('xhr_') && f.endsWith('.request.yaml'));

    for (const file of files) {
      try {
        const result = RequestResult.load(path.join(requestsDir, file));
        if (existingIds.has(result.id)) continue;
        this.capturedRequests.push(result);
      } catch {
        // skip invalid files
      }
    }
  }

  getWriteRequestsForScope(scopePath: string): RequestResult[] {
    const writeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
    const writes = this.capturedRequests.filter((r) => writeMethods.has(r.method));
    const scopeSegments = scopePath.split('/').filter(Boolean);
    if (scopeSegments.length === 0) return writes;

    let scoped: RequestResult[] = [];
    let fewest = Number.POSITIVE_INFINITY;
    let ambiguous = false;
    for (const segment of scopeSegments) {
      if (isDynamicSegment(segment)) continue;
      const matches = writes.filter((r) => r.path.split('/').includes(segment));
      if (matches.length === 0 || matches.length > fewest) continue;
      if (matches.length === fewest) {
        if (!scoped.every((r, i) => r.id === matches[i].id)) ambiguous = true;
        continue;
      }
      scoped = matches;
      fewest = matches.length;
      ambiguous = false;
    }
    if (ambiguous) return [];

    return scoped;
  }

  clear(): void {
    this.capturedRequests = [];
    this.madeRequests = [];
    this.failedRequests = [];
  }
}

export function isFailedRequest(request: RequestResult): boolean {
  return request.status >= 400 || Boolean(request.error);
}
