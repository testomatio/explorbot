import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { createOpenAI } from '@ai-sdk/openai';
import { LLMock } from '@copilotkit/aimock';
import { type Browser, type Page, chromium } from 'playwright';
import { ActionResult } from '../../src/action-result.ts';
import { Provider } from '../../src/ai/provider.ts';
import { Researcher } from '../../src/ai/researcher.ts';
import { clearResearchCache } from '../../src/ai/researcher/cache.ts';
import { ConfigParser } from '../../src/config.ts';
import { annotatePageElements } from '../../src/explorer.ts';

const TASK_BOARD_URL = `file://${join(process.cwd(), 'test-data', 'task-board.html')}`;

const validResearch = `## Navigation

> Container: \`.sidebar-nav\`

| Element | Type | ARIA | CSS | Coordinates |
|------|------|------|------|------|
| 'Dashboard' | link | { role: 'link', text: 'Dashboard' } | '.sidebar-nav a[href="/dashboard"]' | (32, 88) |
| 'Task Board' | link | { role: 'link', text: 'Task Board' } | '.sidebar-nav a.active' | (32, 128) |
| 'Projects' | link | { role: 'link', text: 'Projects' } | '.sidebar-nav a[href="/projects"]' | (32, 168) |

## Content

> Container: \`.board-header\`

| Element | Type | ARIA | CSS | Coordinates |
|------|------|------|------|------|
| 'Create Task' | button | { role: 'button', text: 'Create Task' } | '.create-task-btn' | (240, 30) |
| 'Search tasks' | textbox | { role: 'textbox', text: 'Search tasks' } | '.search-input' | (420, 30) |
| 'Board view' | button | { role: 'button', text: 'Board' } | '.view-board' | (920, 30) |
`;

const brokenResearch = `## Navigation

> Container: \`.sidebar-nav\`

| Element | Type | ARIA | CSS | Coordinates |
|------|------|------|------|------|
| 'Dashboard' | link | { role: 'link', text: 'Dashboard' } | '.sidebar-nav a[href="/dashboard"]' | (32, 88) |

## Content

> Container: \`.board-header\`

| Element | Type | ARIA | CSS | Coordinates |
|------|------|------|------|------|
| 'Create Task' | button | { role: 'button', text: 'Create Task' } | '.does-not-exist' | (240, 30) |
| 'Search tasks' | textbox | { role: 'textbox', text: 'Search tasks' } | '.also-fake-selector' | (420, 30) |
`;

const fixedResearch = `## Content

> Container: \`.board-header\`

| Element | Type | ARIA | CSS | Coordinates |
|------|------|------|------|------|
| 'Create Task' | button | { role: 'button', text: 'Create Task' } | '.create-task-btn' | (240, 30) |
| 'Search tasks' | textbox | { role: 'textbox', text: 'Search tasks' } | '.search-input' | (420, 30) |
`;

describe('Researcher with real browser + aimock', () => {
  let browser: Browser;
  let page: Page;
  let mock: LLMock;
  let provider: Provider;
  let researcher: Researcher;

  async function captureRealState() {
    const html = await page.content();
    const title = await page.title();
    const ariaSnapshot = await page.locator('body').ariaSnapshot({ mode: 'ai' });
    return {
      url: '/tasks/board',
      title,
      hash: `real-browser-hash-${Date.now()}`,
      html,
      ariaSnapshot,
    };
  }

  function buildExplorer(state: any) {
    const mockExperienceTracker = {
      getSuccessfulExperience: () => [],
      updateSummary: () => {},
    };
    const mockStateManager = {
      getCurrentState: () => state,
      getVisitCount: () => 0,
      getExperienceTracker: () => mockExperienceTracker,
      getRelevantKnowledge: () => [],
    };
    return {
      getStateManager: () => mockStateManager,
      getKnowledgeTracker: () => ({ getRelevantKnowledge: () => [] }),
      getConfig: () => ConfigParser.getInstance().getConfig(),
      visit: async () => {},
      annotateElements: async () => (await annotatePageElements(page)).elements,
      createAction: () => ({
        capturePageState: async () => ActionResult.fromState(state),
        caputrePageWithScreenshot: async () => ActionResult.fromState(state),
      }),
      playwrightLocatorCount: async (cb: (p: any) => any) => {
        const locator = cb(page);
        return locator.count();
      },
      playwrightHelper: { page },
    } as any;
  }

  beforeAll(async () => {
    browser = await chromium.launch();
    page = await browser.newPage();
    await page.goto(TASK_BOARD_URL, { waitUntil: 'domcontentloaded' });

    mock = new LLMock({ port: 0, logLevel: 'silent' });
    await mock.start();

    const openai = createOpenAI({
      baseURL: `${mock.url}/v1`,
      apiKey: 'test-key',
      compatibility: 'compatible',
    });

    provider = new Provider({
      model: openai.chat('test-model'),
      config: {},
    });
  });

  beforeEach(async () => {
    mock.clearRequests();
    mock.resetMatchCounts();
    mock.clearFixtures();
    clearResearchCache();
    ConfigParser.setupTestConfig();

    const state = await captureRealState();
    researcher = new Researcher(buildExplorer(state), provider);
  });

  afterAll(async () => {
    await page?.close();
    await browser?.close();
    await mock.stop();
  });

  it('validates locators against real DOM and returns research', async () => {
    const state = await captureRealState();
    mock.on({}, { content: validResearch });

    const result = await researcher.research(state);

    expect(result).toContain('Create Task');
    expect(result).toContain('.create-task-btn');
    expect(result).toContain('Search tasks');
  });

  it('detects broken locator and asks AI to fix it', async () => {
    const state = await captureRealState();

    mock.on({ sequenceIndex: 0 }, { content: brokenResearch });
    mock.on({ sequenceIndex: 1 }, { content: fixedResearch });

    const result = await researcher.research(state);

    expect(mock.getRequests().length).toBe(2);

    const fixRequest = mock.getRequests()[1] as any;
    const fixPrompt = fixRequest.body.messages.map((m: any) => (typeof m.content === 'string' ? m.content : '')).join('\n');
    expect(fixPrompt).toContain('Some locators in your research are broken');
    expect(fixPrompt).toContain('.does-not-exist');
    expect(fixPrompt).toContain('BROKEN');

    expect(result).toContain('.create-task-btn');
    expect(result).toContain('.search-input');
    expect(result).not.toContain('.does-not-exist');
    expect(result).not.toContain('.also-fake-selector');
  });
});
