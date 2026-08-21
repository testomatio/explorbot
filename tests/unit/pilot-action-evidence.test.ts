import { describe, expect, it } from 'bun:test';
import { Pilot } from '../../src/ai/pilot.ts';
import { RequestStore } from '../../src/api/request-store.ts';

function buildPilot(): Pilot {
  const deps: any = {
    ai: {},
    explorer: {},
    stateManager: { otherTabs: [] },
    requestStore: new RequestStore('/tmp/pilot-actions-test'),
    playwrightRecorder: {},
  };
  return new Pilot(deps, {}, {} as any);
}

function clickWith(pageDiff: any) {
  return [{ toolName: 'click', wasSuccessful: true, input: { explanation: 'Save the run' }, output: { pageDiff } }];
}

function format(pageDiff: any): string {
  return (buildPilot() as any).formatActions(clickWith(pageDiff));
}

describe('Pilot recent_actions evidence', () => {
  it('names the rejected request and the message the app showed', () => {
    const line = format({
      urlChanged: false,
      currentUrl: '/runs',
      requests: [{ method: 'POST', path: '/api/runs', status: 400 }],
      messages: ['Operation against a key holding the wrong kind of value'],
      consoleErrors: ['Ember Data Request POST /api/runs returned a 400'],
    });

    expect(line).toContain('requests: POST /api/runs → 400');
    expect(line).toContain('messages: Operation against a key holding the wrong kind of value');
    expect(line).toContain('console: Ember Data Request POST /api/runs returned a 400');
  });

  it('drops requests that succeeded', () => {
    const line = format({
      urlChanged: false,
      currentUrl: '/runs',
      requests: [
        { method: 'GET', path: '/api/runs', status: 200 },
        { method: 'POST', path: '/api/runs', status: 500 },
      ],
    });

    expect(line).toContain('requests: POST /api/runs → 500');
    expect(line).not.toContain('/api/runs → 200');
  });

  it('keeps at most two messages and one console error', () => {
    const line = format({
      urlChanged: false,
      currentUrl: '/runs',
      messages: ['first', 'second', 'third'],
      consoleErrors: ['one', 'two'],
    });

    expect(line).toContain('messages: first | second');
    expect(line).not.toContain('third');
    expect(line).toContain('console: one');
    expect(line).not.toContain('two');
  });

  it('adds no evidence lines when the action produced none', () => {
    const line = format({ urlChanged: false, currentUrl: '/runs' });

    expect(line).not.toContain('requests:');
    expect(line).not.toContain('messages:');
    expect(line).not.toContain('console:');
  });
});
