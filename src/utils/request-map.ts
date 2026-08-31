import type { RequestResult } from '../api/request-result.ts';

export class RequestMap {
  private requests = new Map<string, RequestResult>();

  constructor(requests: RequestResult[] = []) {
    for (const request of requests) this.add(request);
  }

  add(request: RequestResult): void {
    const { id } = request.extractIdAndTitle();
    if (id === undefined) return;
    this.requests.set(String(id), request);
  }

  get(id: string | number): RequestResult | undefined {
    return this.requests.get(String(id));
  }
}
