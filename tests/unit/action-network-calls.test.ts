import { beforeEach, describe, expect, it } from 'bun:test';
import Action from '../../src/action.ts';
import { ConfigParser } from '../../src/config.ts';

function buildAction(): Action {
  return new Action({} as any, {} as any);
}

function request(path: string, method = 'GET') {
  return { method: () => method, resourceType: () => 'xhr', url: () => `https://example.com${path}` };
}

function record(action: Action, count: number, status: number, prefix: string): void {
  for (let i = 0; i < count; i++) {
    (action as any).recordNetworkCall(request(`/api/${prefix}/${i}`), status);
  }
}

describe('Action network calls', () => {
  beforeEach(() => {
    ConfigParser.resetForTesting();
    ConfigParser.setupTestConfig();
  });

  it('stops collecting successful calls once the list is full', () => {
    const action = buildAction();

    record(action, 12, 200, 'ok');

    expect((action as any).networkRequests).toHaveLength(10);
  });

  it('makes room for a rejected call by dropping a successful one', () => {
    const action = buildAction();
    record(action, 10, 200, 'ok');

    (action as any).recordNetworkCall(request('/api/runs', 'POST'), 500);

    const calls = (action as any).networkRequests;
    expect(calls).toHaveLength(10);
    expect(calls).toContainEqual({ method: 'POST', path: '/api/runs', status: 500 });
  });

  it('keeps the earliest failures when every call was rejected', () => {
    const action = buildAction();
    record(action, 10, 500, 'failed');

    (action as any).recordNetworkCall(request('/api/runs', 'POST'), 500);

    const calls = (action as any).networkRequests;
    expect(calls).toHaveLength(10);
    expect(calls).not.toContainEqual({ method: 'POST', path: '/api/runs', status: 500 });
  });
});
