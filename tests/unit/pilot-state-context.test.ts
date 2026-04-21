import { describe, expect, it } from 'bun:test';
import { ActionResult } from '../../src/action-result.ts';
import { Pilot } from '../../src/ai/pilot.ts';
import { RequestResult } from '../../src/api/request-result.ts';
import { RequestStore } from '../../src/api/request-store.ts';

function buildActionResult(browserLogs: any[] = [], ariaSnapshot = ''): ActionResult {
  return new ActionResult({
    url: '/page',
    title: 'Page',
    html: '<html></html>',
    ariaSnapshot,
    browserLogs,
  });
}

function buildPilotWithStore(store: RequestStore | null, hasOtherTabs = false): Pilot {
  const explorer: any = {
    getRequestStore: () => store,
    hasOtherTabs: () => hasOtherTabs,
    getOtherTabsInfo: () => [],
  };
  const provider: any = {};
  const researcher: any = {};
  return new Pilot(provider, {}, researcher, explorer);
}

function makeFailure(method: string, path: string, status: number, counter: number): RequestResult {
  return new RequestResult({
    id: `fail_${counter}`,
    method,
    path,
    fullUrl: path,
    requestHeaders: {},
    status,
    statusText: String(status),
    responseHeaders: {},
    timing: 0,
    timestamp: new Date(),
  });
}

describe('Pilot buildStateContext — error signals', () => {
  it('emits "console errors: none" and "network errors: none" on clean state', () => {
    const store = new RequestStore('/tmp/pilot-ctx-test-1');
    const pilot = buildPilotWithStore(store);
    const context = (pilot as any).buildStateContext(buildActionResult());
    expect(context).toContain('console errors: none');
    expect(context).toContain('network errors: none');
  });

  it('renders console errors with count and sample', () => {
    const store = new RequestStore('/tmp/pilot-ctx-test-2');
    const pilot = buildPilotWithStore(store);
    const state = buildActionResult([
      { type: 'error', text: 'TypeError: Cannot read x' },
      { type: 'warning', text: 'deprecated API' },
      { type: 'error', text: 'ReferenceError: foo' },
    ]);
    const context = (pilot as any).buildStateContext(state);
    expect(context).toContain('console errors: 2');
    expect(context).toContain('TypeError: Cannot read x');
    expect(context).toContain('ReferenceError: foo');
    expect(context).not.toContain('deprecated API');
  });

  it('accepts both .type and .level log fields', () => {
    const store = new RequestStore('/tmp/pilot-ctx-test-3');
    const pilot = buildPilotWithStore(store);
    const state = buildActionResult([{ level: 'error', message: 'legacy-shape error' }]);
    const context = (pilot as any).buildStateContext(state);
    expect(context).toContain('console errors: 1');
    expect(context).toContain('legacy-shape error');
  });

  it('renders network errors from RequestStore failures', () => {
    const store = new RequestStore('/tmp/pilot-ctx-test-4');
    store.addFailedRequest(makeFailure('GET', '/api/users', 404, 1));
    store.addFailedRequest(makeFailure('POST', '/api/items', 500, 2));
    const pilot = buildPilotWithStore(store);
    const context = (pilot as any).buildStateContext(buildActionResult());
    expect(context).toContain('network errors: GET /api/users → 404, POST /api/items → 500');
  });

  it('limits network errors to last 5 entries', () => {
    const store = new RequestStore('/tmp/pilot-ctx-test-5');
    for (let i = 1; i <= 7; i++) {
      store.addFailedRequest(makeFailure('GET', `/api/r${i}`, 404, i));
    }
    const pilot = buildPilotWithStore(store);
    const context = (pilot as any).buildStateContext(buildActionResult());
    expect(context).toContain('/api/r3');
    expect(context).toContain('/api/r7');
    expect(context).not.toContain('/api/r1 →');
    expect(context).not.toContain('/api/r2 →');
  });

  it('tolerates missing RequestStore', () => {
    const pilot = buildPilotWithStore(null);
    const context = (pilot as any).buildStateContext(buildActionResult());
    expect(context).toContain('network errors: none');
  });
});
