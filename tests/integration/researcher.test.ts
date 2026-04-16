import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createOpenAI } from '@ai-sdk/openai';
import { LLMock } from '@copilotkit/aimock';
import { ActionResult } from '../../src/action-result.ts';
import { clearResearchCache, getCachedResearch, saveResearch } from '../../src/ai/researcher/cache.ts';
import { Researcher } from '../../src/ai/researcher.ts';
import { Provider } from '../../src/ai/provider.ts';
import { ConfigParser } from '../../src/config.ts';

const UI_MAPS_DIR = join(process.cwd(), 'test-data', 'ui-maps');
const taskBoardResearch = readFileSync(join(UI_MAPS_DIR, 'task-board-research.md'), 'utf8');

const taskBoardHtml = `<html>
<head><title>Task Board - Task Tracker</title></head>
<body>
  <nav class="sidebar-nav">
    <a href="/dashboard">Dashboard</a>
    <a href="/tasks/board">Task Board</a>
    <a href="/projects">Projects</a>
    <a href="/reports">Reports</a>
    <a href="/settings">Settings</a>
  </nav>
  <main>
    <header class="board-header">
      <button class="primary">Create Task</button>
      <input type="search" placeholder="Search tasks">
      <select class="assignee-filter"><option>All assignees</option></select>
      <select class="sort"><option>Sort by date</option></select>
      <button class="view-board">Board</button>
      <button class="view-list">List</button>
    </header>
    <section class="board-columns">
      <div class="column-todo"><h2>To Do</h2><button class="add-task">Add</button></div>
      <div class="column-progress"><h2>In Progress</h2></div>
      <div class="column-done"><h2>Done</h2></div>
    </section>
  </main>
</body>
</html>`;

const fakeState = {
  url: '/tasks/board',
  title: 'Task Board - Task Tracker',
  hash: 'researcher-test-hash-001',
  html: taskBoardHtml,
  ariaSnapshot: '- region "main":\n  - button "Create Task"\n  - textbox "Search tasks"\n  - combobox "Assignee"\n  - combobox "Sort by"',
};

function createMockExplorer(state = fakeState) {
  const mockExperienceTracker = {
    getSuccessfulExperience: () => [],
    updateSummary: () => {},
  };
  const mockKnowledgeTracker = {
    getRelevantKnowledge: () => [],
  };
  const mockStateManager = {
    getCurrentState: () => state,
    getVisitCount: () => 0,
    getExperienceTracker: () => mockExperienceTracker,
    getRelevantKnowledge: () => [],
  };
  return {
    getStateManager: () => mockStateManager,
    getKnowledgeTracker: () => mockKnowledgeTracker,
    getConfig: () => ConfigParser.getInstance().getConfig(),
    visit: async () => {},
    annotateElements: async () => [],
    createAction: () => ({
      capturePageState: async () => ActionResult.fromState(state),
      caputrePageWithScreenshot: async () => ActionResult.fromState(state),
    }),
    playwrightLocatorCount: async () => 1,
    playwrightHelper: { page: {} },
  } as any;
}

function extractPromptText(entry: any): string {
  if (!entry?.body?.messages) return '';
  return entry.body.messages
    .map((m: any) => {
      if (typeof m.content === 'string') return m.content;
      if (Array.isArray(m.content)) {
        return m.content
          .filter((p: any) => p.type === 'text')
          .map((p: any) => p.text || '')
          .join('\n');
      }
      return '';
    })
    .join('\n');
}

describe('Researcher with aimock', () => {
  let mock: LLMock;
  let provider: Provider;
  let researcher: Researcher;

  beforeAll(async () => {
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

  beforeEach(() => {
    mock.clearRequests();
    mock.resetMatchCounts();
    mock.clearFixtures();
    clearResearchCache();
    ConfigParser.setupTestConfig();

    researcher = new Researcher(createMockExplorer(), provider);

    mock.on({}, { content: taskBoardResearch });
  });

  afterAll(async () => {
    await mock.stop();
  });

  it('returns research markdown from AI response', async () => {
    const result = await researcher.research(fakeState, { fix: false });

    expect(result).toContain('## Navigation');
    expect(result).toContain('## Content');
    expect(result).toContain('Create Task');
    expect(result).toContain('Search tasks');
  });

  it('injects HTML into research prompt', async () => {
    await researcher.research(fakeState, { fix: false });

    const prompt = extractPromptText(mock.getLastRequest());
    expect(prompt).toContain('board-header');
    expect(prompt).toContain('Create Task');
  });

  it('injects ARIA snapshot into prompt', async () => {
    await researcher.research(fakeState, { fix: false });

    const prompt = extractPromptText(mock.getLastRequest());
    expect(prompt).toContain('textbox "Search tasks"');
  });

  it('includes senior QA role in system message', async () => {
    await researcher.research(fakeState, { fix: false });

    const lastReq = mock.getLastRequest() as any;
    const systemMsg = lastReq?.body?.messages?.find((m: any) => m.role === 'system');
    expect(systemMsg?.content).toContain('senior QA');
  });

  it('includes URL in prompt context', async () => {
    await researcher.research(fakeState, { fix: false });

    const prompt = extractPromptText(mock.getLastRequest());
    expect(prompt).toContain('/tasks/board');
  });

  it('returns cached research without AI call', async () => {
    saveResearch(fakeState.hash!, '## Cached Research\n\nPreviously analyzed page.');

    const result = await researcher.research(fakeState, { fix: false });

    expect(result).toContain('Cached Research');
    expect(result).toContain('CACHED AND MAY NOT REPRESENT CURRENT STATE');
    expect(mock.getRequests().length).toBe(0);
  });

  it('force flag bypasses cache', async () => {
    saveResearch(fakeState.hash!, '## Cached Research\n\nOld cached content.');

    const result = await researcher.research(fakeState, { fix: false, force: true });

    expect(result).toContain('## Navigation');
    expect(result).not.toContain('CACHED AND MAY NOT REPRESENT');
    expect(mock.getRequests().length).toBe(1);
  });

  it('saves research result to cache after AI call', async () => {
    await researcher.research(fakeState, { fix: false });

    const cached = getCachedResearch(fakeState.hash!);
    expect(cached).toContain('## Navigation');
    expect(cached).toContain('Create Task');
  });
});
