import type { RequestResult } from '../../api/request-result.ts';
import { type RequestStore, isFailedRequest } from '../../api/request-store.ts';

export class RequestHaul {
  private start: number;

  constructor(private store: RequestStore) {
    this.start = store.getMadeRequests().length;
  }

  requests(): RequestResult[] {
    return this.store.getMadeRequests().slice(this.start);
  }

  failed(): RequestResult[] {
    return this.requests().filter(isFailedRequest);
  }

  successfulWrites(): RequestResult[] {
    return this.requests().filter((r) => r.isWrite && !r.error && r.status >= 200 && r.status < 400);
  }

  successfulReads(): RequestResult[] {
    return this.requests().filter((r) => !r.isWrite && !r.error && r.status >= 200 && r.status < 400);
  }

  byId(): Map<string, RequestResult> {
    const map = new Map<string, RequestResult>();
    for (const request of this.successfulWrites()) {
      const { id } = request.extractIdAndTitle();
      if (id === undefined) continue;
      map.set(String(id), request);
    }
    return map;
  }
}
