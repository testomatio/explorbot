import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createOpenAI } from '@ai-sdk/openai';
import { LLMock } from '@copilotkit/aimock';
import { type Browser, type Page, chromium } from 'playwright';
import { ActionResult } from '../../src/action-result.ts';
import { Provider } from '../../src/ai/provider.ts';
import { Researcher } from '../../src/ai/researcher.ts';
import { clearResearchCache } from '../../src/ai/researcher/cache.ts';
import { ConfigParser } from '../../src/config.ts';

const TASK_BOARD_HTML = readFileSync(join(process.cwd(), 'test-data', 'task-board.html'), 'utf-8');

const research = `## Content

> Container: \`.board-header\`

| Element | Type | ARIA | CSS | Coordinates |
|------|------|------|------|------|
| 'Create Task' | button | { role: 'button', text: 'Create Task' } | '.create-task-btn' | (240, 30) |
`;

const welcomeResearch = `## Content

> Container: \`body\`

| Element | Type | ARIA | CSS | Coordinates |
|------|------|------|------|------|
| 'Continue' | button | { role: 'button', text: 'Continue' } | 'button' | (40, 60) |
`;

describe('Researcher waits for a page that renders late', () => {
  let browser: Browser;
  let page: Page;
  let mock: LLMock;
  let provider: Provider;

  async function captureRealState() {
    return new ActionResult({
      url: '/tasks/board',
      title: await page.title(),
      html: await page.content(),
      ariaSnapshot: await page.locator('body').ariaSnapshot({ mode: 'ai' }),
    });
  }

  function createResearcher(judge?: any) {
    const explorer = {
      visit: captureRealState,
      capture: captureRealState,
      withPage: async (fn: any) => fn(page),
      page,
    } as any;
    const state = { url: '/tasks/board', title: '', hash: `slow-page-${Date.now()}`, html: '' };
    return new Researcher({
      explorer,
      ai: provider,
      config: ConfigParser.getInstance().getConfig(),
      stateManager: {
        getCurrentState: () => state,
        getVisitCount: () => 0,
        getRelevantKnowledge: () => [],
        getExperienceTracker: () => ({ getSuccessfulExperience: () => [], updateSummary: () => {} }),
      },
      knowledgeTracker: { getRelevantKnowledge: () => [], renderRelevantKnowledge: () => '', renderRelevantContext: () => '' },
      judge,
      requestStore: {},
      playwrightRecorder: {},
    } as any);
  }

  beforeAll(async () => {
    browser = await chromium.launch();
    page = await browser.newPage();
    mock = new LLMock({ port: 0, logLevel: 'silent' });
    await mock.start();
    const openai = createOpenAI({ baseURL: `${mock.url}/v1`, apiKey: 'test-key', compatibility: 'compatible' });
    provider = new Provider({ model: openai.chat('test-model'), config: {} });
  });

  beforeEach(() => {
    mock.clearRequests();
    mock.resetMatchCounts();
    mock.clearFixtures();
    clearResearchCache();
    ConfigParser.setupTestConfig();
  });

  afterAll(async () => {
    await page?.close();
    await browser?.close();
    await mock.stop();
  });

  it('keeps waiting while the page is blank, then researches the rendered content', async () => {
    await page.setContent(`<html><body><div id="app"></div><script>setTimeout(() => { document.open(); document.write(${JSON.stringify(TASK_BOARD_HTML)}); document.close(); }, 4500);</script></body></html>`);
    mock.on({}, { content: research });

    const result = await createResearcher().research(await captureRealState());

    expect(mock.getRequests().length).toBe(1);
    const researchPrompt = JSON.stringify(mock.getRequests().at(-1)?.body);
    expect(researchPrompt).toContain('Create Task');
    expect(result).toContain('Create Task');
  }, 30000);

  it('does not wait out the timeout on a small page that has rendered', async () => {
    await page.setContent('<html><body><h1>Welcome</h1><button>Continue</button></body></html>');
    mock.on({}, { content: research });

    const started = Date.now();
    await createResearcher().research(await captureRealState());

    expect(Date.now() - started).toBeLessThan(8000);
  }, 30000);

  it('asks the judge about a small page and keeps waiting while it is still loading', async () => {
    await page.setContent(`<html><body><p>Starting</p><script>setTimeout(() => { document.open(); document.write(${JSON.stringify(TASK_BOARD_HTML)}); document.close(); }, 2000);</script></body></html>`);
    mock.on({}, { content: research });
    const questions: string[] = [];
    const judge = { pick: async (question: string) => questions.push(question) && 1 };

    const result = await createResearcher(judge).research(await captureRealState());

    expect(questions.length).toBe(1);
    expect(result).toContain('Create Task');
  }, 30000);

  it('stops research when the judge sees an error page', async () => {
    await page.setContent('<html><body><p>Something went wrong</p></body></html>');
    mock.on({}, { content: research });
    const judge = { pick: async () => 2 };

    await expect(createResearcher(judge).research(await captureRealState())).rejects.toThrow('Error page detected');
  }, 30000);

  it('continues right away when the judge sees a loaded small page', async () => {
    await page.setContent('<html><body><h1>Welcome</h1><button>Continue</button></body></html>');
    mock.on({}, { content: welcomeResearch });
    let asked = 0;
    const judge = { pick: async () => ++asked && 3 };

    const started = Date.now();
    await createResearcher(judge).research(await captureRealState());

    expect(asked).toBe(1);
    expect(Date.now() - started).toBeLessThan(8000);
  }, 30000);
});
