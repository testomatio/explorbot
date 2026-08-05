import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createOpenAI } from '@ai-sdk/openai';
import { LLMock } from '@copilotkit/aimock';
import { Prima } from '../../boat/prima/src/prima.ts';
import { ActionResult } from '../../src/action-result.ts';
import { Navigator } from '../../src/ai/navigator.ts';
import { Provider } from '../../src/ai/provider.ts';
import { ConfigParser } from '../../src/config.ts';

const checkoutState = {
  url: '/checkout',
  title: 'Checkout - Widget Depot',
  hash: 'checkout_h1_checkout',
  html: '<html><body><h1>Checkout</h1><button id="place-order">Place order</button></body></html>',
  ariaSnapshot: '- heading "Checkout" [level=1]\n- button "Place order"',
};

const recovery = ['Both routes below reach the same outcome.', '', "```js\nI.click('Confirm purchase')\n```", '', "```js\nI.click('#place-order')\n```"].join('\n');

function extractPromptText(entry: any): string {
  if (!entry?.body?.messages) return '';
  return entry.body.messages
    .map((message: any) => {
      if (typeof message.content === 'string') return message.content;
      if (Array.isArray(message.content)) {
        return message.content
          .filter((part: any) => part.type === 'text')
          .map((part: any) => part.text || '')
          .join('\n');
      }
      return '';
    })
    .join('\n');
}

describe('Prima heal with aimock', () => {
  let mock: LLMock;
  let provider: Provider;
  let prima: Prima;
  let attempted: string[];
  let artifacts: string;

  function buildNavigator(succeedsWith: string): Navigator {
    const action: any = {
      lastError: null,
      actionResult: null,
      exitIframe: async () => {},
      attempt: async (code: string) => {
        attempted.push(code);
        if (code.includes(succeedsWith)) {
          action.lastError = null;
          return true;
        }
        action.lastError = new Error('element not visible');
        return false;
      },
      getActor: () => ({ wait: async () => {} }),
      stateManager: { getCurrentState: () => checkoutState },
    };

    const experienceTracker = { getSuccessfulExperience: () => [], writeFlow: () => {} };
    return new Navigator({
      explorer: { action: () => action, capture: async () => ActionResult.fromState(checkoutState as any) } as any,
      ai: provider,
      config: ConfigParser.getInstance().getConfig(),
      stateManager: { getCurrentState: () => checkoutState, getVisitCount: () => 1, getExperienceTracker: () => experienceTracker } as any,
      knowledgeTracker: { renderRelevantKnowledge: () => '', renderRelevantContext: () => '', getRelevantKnowledge: () => [] } as any,
      requestStore: {} as any,
      playwrightRecorder: {} as any,
    });
  }

  beforeAll(async () => {
    mock = new LLMock({ port: 0, logLevel: 'silent' });
    await mock.start();

    const openai = createOpenAI({
      baseURL: `${mock.url}/v1`,
      apiKey: 'test-key',
      compatibility: 'compatible',
    });

    ConfigParser.resetForTesting();
    ConfigParser.setupTestConfig();
    provider = new Provider({ model: openai.chat('test-model'), config: {} });
    artifacts = mkdtempSync(path.join(tmpdir(), 'prima-heal-'));
  });

  beforeEach(() => {
    mock.clearRequests();
    mock.resetMatchCounts();
    mock.clearFixtures();

    attempted = [];
    prima = new Prima({ instance: 'default' });
    (prima as any).artifactsDir = artifacts;
    (prima as any).bot = {
      getExplorer: () => ({
        action: () => ({
          execute: async () => {
            throw new Error("locator 'text=Confirm' not found");
          },
        }),
        capture: async () => ActionResult.fromState(checkoutState as any),
      }),
      stateManager: () => ({ getCurrentState: () => checkoutState, getVisitCount: () => 1 }),
      getCurrentState: () => checkoutState,
      requestStore: () => ({ getRequests: () => [] }),
      getProvider: () => provider,
    };
  });

  afterAll(async () => {
    await mock.stop();
    rmSync(artifacts, { recursive: true, force: true });
    ConfigParser.cleanupAllTestDirectories();
  });

  it('recovers a failed pw along another route and reports the code that worked', async () => {
    mock.on({}, { content: recovery });
    (prima as any).bot.agentNavigator = () => buildNavigator('#place-order');

    const envelope = await prima.pw("({ page }) => page.click('text=Confirm')");

    expect(envelope.ok).toBe(true);
    expect(envelope.healed).toBe(true);
    expect(envelope.healNote).toContain('2 attempts');
    expect(envelope.used).toEqual(["I.click('#place-order')"]);
    expect(attempted).toEqual(["I.click('Confirm purchase')", "I.click('#place-order')"]);
  });

  it('asks the model to reach the same outcome another way', async () => {
    mock.on({}, { content: recovery });
    (prima as any).bot.agentNavigator = () => buildNavigator('#place-order');

    await prima.pw("({ page }) => page.click('text=Confirm')");

    const prompt = extractPromptText(mock.getLastRequest());
    expect(prompt).toContain("({ page }) => page.click('text=Confirm')");
    expect(prompt).toContain("locator 'text=Confirm' not found");
    expect(prompt).toContain('Reach the same outcome on the current page in a different way.');
    expect(prompt).toContain('button "Place order"');
  });

  it('reports every attempt and its outcome when recovery does not work', async () => {
    mock.on({}, { content: recovery });
    (prima as any).bot.agentNavigator = () => buildNavigator('nothing-matches-this');

    const envelope = await prima.pw("({ page }) => page.click('text=Confirm')");

    expect(envelope.ok).toBe(false);
    expect(envelope.failure?.error).toContain("locator 'text=Confirm' not found");
    expect(envelope.failure?.attempts.map((attempt) => attempt.code)).toContain("I.click('#place-order')");
    expect(envelope.failure?.attempts.every((attempt) => attempt.outcome.includes('element not visible'))).toBe(true);
    expect(envelope.failure?.compactAria).toContain('button "Place order"');
  });
});
