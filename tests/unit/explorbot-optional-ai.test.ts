import { beforeAll, describe, expect, test } from 'bun:test';
import { ConfigParser } from '../../src/config.ts';
import { ExplorBot } from '../../src/explorbot.ts';

beforeAll(() => {
  ConfigParser.resetForTesting();
  ConfigParser.setupTestConfig();
});

describe('ExplorBot provider bootstrap', () => {
  test('provider failure stays fatal for regular callers', async () => {
    const bot = new ExplorBot({});
    await expect(bot.startProviderOnly()).rejects.toThrow();
    expect(bot.aiFailureReason()).toBeNull();
  });

  test('optionalAi records the reason instead of failing the start', async () => {
    const bot = new ExplorBot({ optionalAi: true });
    await bot.startProviderOnly();
    expect(bot.getProvider()).toBeUndefined();
    expect(bot.aiFailureReason()).toBeTruthy();
    expect(bot.getConfig()).toBeTruthy();
  });
});
