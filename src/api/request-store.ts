import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { RequestResult } from './request-result.ts';

const AUTH_HEADERS = ['authorization', 'cookie', 'x-api-key', 'x-csrf-token'];

export class RequestStore {
  private capturedRequests: RequestResult[] = [];
  private madeRequests: RequestResult[] = [];
  private outputDir: string;

  constructor(outputDir: string) {
    this.outputDir = outputDir;
  }

  addCapturedRequest(result: RequestResult): void {
    this.capturedRequests.push(result);
    result.save(this.outputDir);
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

  toEndpointList(): string {
    const seen = new Set<string>();
    const lines: string[] = [];

    for (const req of this.capturedRequests) {
      const normalized = normalizePathPattern(req.path);
      const key = `${req.method} ${normalized}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(key);
    }

    return lines.join('\n');
  }

  extractAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};

    for (let i = this.capturedRequests.length - 1; i >= 0; i--) {
      const req = this.capturedRequests[i];
      for (const [key, value] of Object.entries(req.requestHeaders)) {
        if (AUTH_HEADERS.includes(key.toLowerCase()) && !headers[key]) {
          headers[key] = value;
        }
      }
      if (AUTH_HEADERS.every((h) => Object.keys(headers).some((k) => k.toLowerCase() === h))) break;
    }

    return headers;
  }

  findCapturedRequest(method: string, pathPrefix: string): RequestResult | undefined {
    const upper = method.toUpperCase();
    return this.capturedRequests.find((r) => r.method === upper && r.path.startsWith(pathPrefix));
  }

  toLog(): string {
    return this.madeRequests.map((r, i) => `${i + 1}. ${r.toSummary()} [${r.id}]`).join('\n');
  }

  loadFromDisk(): void {
    const requestsDir = path.join(this.outputDir, 'requests');
    if (!existsSync(requestsDir)) return;

    const existingIds = new Set(this.capturedRequests.map((r) => r.id));
    const files = readdirSync(requestsDir).filter((f) => f.endsWith('.request.yaml'));

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
    return this.capturedRequests.filter((r) => writeMethods.has(r.method) && r.path.startsWith(scopePath));
  }

  clear(): void {
    this.capturedRequests = [];
    this.madeRequests = [];
  }
}

function normalizePathPattern(urlPath: string): string {
  return urlPath.replace(/\/[0-9a-f]{24}\b/g, '/{id}').replace(/\/\d+\b/g, '/{id}');
}
