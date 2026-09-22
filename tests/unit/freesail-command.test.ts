import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { Conversation } from '../../src/ai/conversation.ts';
import { Navigator } from '../../src/ai/navigator.ts';
import { Planner } from '../../src/ai/planner.ts';
import { Researcher } from '../../src/ai/researcher.ts';
import { FreesailCommand } from '../../src/commands/freesail-command.ts';
import { ConfigParser } from '../../src/config.ts';
import type { ExplorBot } from '../../src/explorbot.ts';

beforeEach(() => {
  ConfigParser.resetForTesting();
  ConfigParser.setupTestConfig();
});

afterEach(() => {
  mock.restore();
});

describe('FreesailCommand', () => {
  test('stops when Navigator proposes the current page again', async () => {
    spyOn(Researcher, 'getCachedResearch').mockReturnValue('cached research');
    spyOn(Planner, 'getCachedPlan').mockReturnValue({ tests: [{ result: 'passed' }] } as any);

    const currentState = { url: '/', hash: 'root' };
    const freeSail = mock(async () => ({ target: 'http://localhost:5173/', reason: 'only page available' }));
    const openTab = mock(async () => {});
    const visit = mock(async () => {});
    const explorBot = {
      visitInitialState: async () => {},
      stateManager: () => ({
        getCurrentState: () => currentState,
        getAllVisitedUrls: () => new Set(['/']),
      }),
      agentNavigator: () => ({ freeSail }),
      openTab,
      visit,
      clearPlan: () => {},
    } as unknown as ExplorBot;

    await new FreesailCommand(explorBot).execute('');

    expect(freeSail).toHaveBeenCalledTimes(1);
    expect(openTab).not.toHaveBeenCalled();
    expect(visit).not.toHaveBeenCalled();
  });

  test('stops when Navigator has no navigation suggestion', async () => {
    spyOn(Researcher, 'getCachedResearch').mockReturnValue('cached research');
    spyOn(Planner, 'getCachedPlan').mockReturnValue({ tests: [{ result: 'passed' }] } as any);

    const freeSail = mock(async () => null);
    const explorBot = {
      visitInitialState: async () => {},
      stateManager: () => ({
        getCurrentState: () => ({ url: '/', hash: 'root' }),
        getAllVisitedUrls: () => new Set(['/']),
      }),
      agentNavigator: () => ({ freeSail }),
    } as unknown as ExplorBot;

    await new FreesailCommand(explorBot).execute('');

    expect(freeSail).toHaveBeenCalledTimes(1);
  });

  test('continues when Navigator proposes a different page', async () => {
    spyOn(Researcher, 'getCachedResearch').mockReturnValue('cached research');
    spyOn(Planner, 'getCachedPlan').mockReturnValue({ tests: [{ result: 'passed' }] } as any);

    const freeSail = mock(async () => {
      if (freeSail.mock.calls.length === 1) return { target: '/next', reason: 'new page' };
      return null;
    });
    const openTab = mock(async () => {});
    const visit = mock(async () => {});
    const clearPlan = mock(() => {});
    const explorBot = {
      visitInitialState: async () => {},
      stateManager: () => ({
        getCurrentState: () => ({ url: '/', hash: 'root' }),
        getAllVisitedUrls: () => new Set(['/']),
      }),
      agentNavigator: () => ({ freeSail }),
      openTab,
      visit,
      clearPlan,
    } as unknown as ExplorBot;

    await new FreesailCommand(explorBot).execute('');

    expect(freeSail).toHaveBeenCalledTimes(2);
    expect(openTab).toHaveBeenCalledTimes(1);
    expect(visit).toHaveBeenCalledWith('/next');
    expect(clearPlan).toHaveBeenCalledTimes(1);
  });
});

describe('Navigator.freeSail', () => {
  test('counts the root path as visited', async () => {
    spyOn(Researcher, 'getCachedResearch').mockReturnValue('');

    let prompt = '';
    const provider = {
      startConversation: () => new Conversation(),
      invokeConversation: async (conversation: Conversation) => {
        prompt = conversation.getLastMessage();
        return { response: { text: 'Next: /\nReason: only page available' } };
      },
    };
    const stateManager = {
      getCurrentState: () => ({ url: '/', hash: 'root' }),
      getStateHistory: () => [],
      getExperienceTracker: () => ({}),
    };
    const navigator = new Navigator({
      ai: provider,
      explorer: {},
      config: {},
      stateManager,
      knowledgeTracker: {},
    } as any);

    const result = await navigator.freeSail({ visitedUrls: new Set(['/']) }, {
      url: '/',
      combinedHtml: async () => '<a href="/">Home</a>',
    } as any);

    expect(prompt).toContain('(1 visit)');
    expect(result?.reason).toEndWith('(visited 1x)');
  });
});
