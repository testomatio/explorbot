import { beforeEach, describe, expect, it } from 'bun:test';
import Action from '../../src/action.ts';
import { ConfigParser } from '../../src/config.ts';

function buildAction(logs: any[]): Action {
  const actor: any = { grabBrowserLogs: async () => logs };
  return new Action(actor, {} as any);
}

describe('Action browser logs', () => {
  beforeEach(() => {
    ConfigParser.resetForTesting();
    ConfigParser.setupTestConfig();
  });

  it('reads playwright console messages, whose type and text are methods', async () => {
    const action = buildAction([
      { type: () => 'error', text: () => 'ReferenceError: foo is not defined' },
      { type: () => 'debug', text: () => 'ignored' },
    ]);

    const logs = await (action as any).captureBrowserLogs();

    expect(logs).toEqual([{ type: 'error', text: 'ReferenceError: foo is not defined' }]);
  });

  it('reads plain log objects and collapses their whitespace', async () => {
    const action = buildAction([{ level: 'warning', message: 'slow\n  response' }]);

    const logs = await (action as any).captureBrowserLogs();

    expect(logs).toEqual([{ type: 'warning', text: 'slow response' }]);
  });
});
