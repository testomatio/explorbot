import type { RequestResult } from './request-result.ts';

export class RequestStateManager {
  private requests: RequestResult[] = [];
  private outputDir: string;

  constructor(outputDir: string) {
    this.outputDir = outputDir;
  }

  addRequest(result: RequestResult): void {
    this.requests.push(result);
    result.save(this.outputDir);
  }

  getRequests(): RequestResult[] {
    return this.requests;
  }

  getLastRequest(): RequestResult | undefined {
    return this.requests[this.requests.length - 1];
  }

  getRequestsByEndpoint(pathPrefix: string): RequestResult[] {
    return this.requests.filter((r) => r.path.startsWith(pathPrefix));
  }

  getRequestsByMethod(method: string): RequestResult[] {
    const upper = method.toUpperCase();
    return this.requests.filter((r) => r.method === upper);
  }

  getRequestsByStatus(status: number): RequestResult[] {
    return this.requests.filter((r) => r.status === status);
  }

  toLog(): string {
    return this.requests.map((r, i) => `${i + 1}. ${r.toSummary()} [${r.id}]`).join('\n');
  }

  clear(): void {
    this.requests = [];
  }
}
