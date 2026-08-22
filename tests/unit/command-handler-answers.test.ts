import { describe, expect, it } from 'bun:test';
import { CommandHandler } from '../../src/command-handler.ts';

function buildHandler(order: string[]) {
  const captain = {
    setCommandExecutor: () => {},
    reviewAnswers: async () => {
      order.push('ask');
    },
    handle: async () => null,
  };

  const handler = new CommandHandler({ agentCaptain: () => captain } as any);
  (handler as any).commands = [
    {
      name: 'demo',
      aliases: [],
      matches: (name: string) => name === 'demo',
      execute: async () => {
        order.push('execute');
      },
      printSuggestions: () => {},
    },
  ];

  return handler;
}

describe('CommandHandler', () => {
  it('has the Captain review collected answers once the command has finished', async () => {
    const order: string[] = [];

    await buildHandler(order).executeCommand('/demo');

    expect(order).toEqual(['execute', 'ask']);
  });
});
