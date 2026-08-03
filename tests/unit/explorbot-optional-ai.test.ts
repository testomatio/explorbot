import { afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigParser } from '../../src/config.ts';
import { ExplorBot } from '../../src/explorbot.ts';
import Explorer from '../../src/explorer.ts';

beforeAll(() => {
  ConfigParser.resetForTesting();
  ConfigParser.setupTestConfig();
});

const spies: Array<{ mockRestore: () => void }> = [];

afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
  rmSync(join(process.cwd(), 'test-dirs'), { recursive: true, force: true });
});

function stubBrowser() {
  spies.push(spyOn(Explorer.prototype as any, 'initializeContainer').mockImplementation(() => {}));
  spies.push(spyOn(Explorer.prototype, 'start').mockImplementation(async () => {}));
}

function seedDynamicExperience() {
  const parser = ConfigParser.getInstance();
  const dir = parser.resolveProjectDir(parser.getConfig().dirs!.experience!);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'users_123.md'), '---\nurl: /users/123\n---\n\n## ACTION: open the user page\n', 'utf-8');
  writeFileSync(join(dir, 'users_456.md'), '---\nurl: /users/456\n---\n\n## ACTION: open the user page\n', 'utf-8');
}

function forbidExit() {
  spies.push(
    spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code}) was called`);
    }) as any)
  );
}

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

  test('start survives a failing provider bootstrap without exiting', async () => {
    stubBrowser();
    forbidExit();
    seedDynamicExperience();

    const bot = new ExplorBot({ optionalAi: true });
    await bot.start();

    expect(bot.isExploring).toBe(true);
    expect(bot.getProvider()).toBeUndefined();
    expect(bot.aiFailureReason()).toBeTruthy();
  });
});
