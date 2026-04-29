import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createOpenAI } from '@ai-sdk/openai';
import { LLMock } from '@copilotkit/aimock';
import { Planner } from '../../src/ai/planner.ts';
import { clearSessionDedup } from '../../src/ai/planner/session-dedup.ts';
import { clearStyleCache } from '../../src/ai/planner/styles.ts';
import { clearPlanRegistry, registerPlan } from '../../src/ai/planner/subpages.ts';
import { Provider } from '../../src/ai/provider.ts';
import { ConfigParser } from '../../src/config.ts';
import { Plan, Test } from '../../src/test-plan.ts';

const UI_MAPS_DIR = join(process.cwd(), 'test-data', 'ui-maps');

const taskBoardUiMap = readFileSync(join(UI_MAPS_DIR, 'task-board.md'), 'utf8');

const defaultScenarios = {
  planName: 'Task Board Testing',
  scenarios: [
    {
      scenario: 'Create a new task via the Create Task modal',
      priority: 'critical',
      startUrl: null,
      steps: ['Click Create Task button', 'Fill in Task title', 'Select Assignee', 'Click Save'],
      expectedOutcomes: ['New task card appears in To Do column', 'Success notification is shown'],
    },
    {
      scenario: 'Filter tasks by assignee',
      priority: 'important',
      startUrl: null,
      steps: ['Click Filter by assignee combobox', 'Select a team member', 'Observe task list'],
      expectedOutcomes: ['Only tasks assigned to selected member are displayed'],
    },
    {
      scenario: 'Search for a task by keyword',
      priority: 'important',
      startUrl: null,
      steps: ['Click Search tasks field', 'Type a task name', 'Observe filtered results'],
      expectedOutcomes: ['Task list updates to show matching tasks'],
    },
    {
      scenario: 'Switch between Board and List views',
      priority: 'normal',
      startUrl: null,
      steps: ['Click List view button', 'Observe the layout change', 'Click Board view button'],
      expectedOutcomes: ['View switches to list layout', 'View switches back to board layout'],
    },
    {
      scenario: 'Apply date range filter and verify results',
      priority: 'normal',
      startUrl: null,
      steps: ['Open Filter Dropdown', 'Set Date range from', 'Set Date range to', 'Click Apply filters'],
      expectedOutcomes: ['Only tasks within the date range are displayed'],
    },
  ],
};

const fakeState = {
  url: '/tasks/board',
  title: 'Task Board - Task Tracker',
  hash: 'abc123fake',
  html: '<html><body>stub</body></html>',
};

function createMockExplorer(state = fakeState) {
  const mockExperienceTracker = { getSuccessfulExperience: () => [] };
  const mockKnowledgeTracker = { getRelevantKnowledge: () => [] };
  const mockStateManager = {
    getCurrentState: () => state,
    getVisitCount: () => 0,
    getExperienceTracker: () => mockExperienceTracker,
  };
  return {
    getStateManager: () => mockStateManager,
    getKnowledgeTracker: () => mockKnowledgeTracker,
    getConfig: () => ConfigParser.getInstance().getConfig(),
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

describe('Planner with aimock', () => {
  let mock: LLMock;
  let provider: Provider;
  let planner: Planner;

  beforeAll(async () => {
    mock = new LLMock({ port: 0, logLevel: 'silent' });
    await mock.start();

    const openai = createOpenAI({
      baseURL: `${mock.url}/v1`,
      apiKey: 'test-key',
      compatibility: 'compatible',
    });

    ConfigParser.setupTestConfig();
    provider = new Provider({
      model: openai.chat('test-model'),
      config: {},
    });
  });

  beforeEach(() => {
    mock.clearRequests();
    mock.resetMatchCounts();
    mock.clearFixtures();
    clearPlanRegistry();
    clearSessionDedup();
    clearStyleCache();

    planner = new Planner(createMockExplorer(), provider);
    planner.researcher = { research: async () => taskBoardUiMap } as any;
    (planner as any).experienceTracker = { getSuccessfulExperience: () => [] };

    mock.on({}, { content: JSON.stringify(defaultScenarios) });
  });

  afterAll(async () => {
    await mock.stop();
  });

  it('generates a plan with correct test structure', async () => {
    const plan = await planner.plan();

    expect(plan).toBeDefined();
    expect(plan.tests.length).toBe(5);
    expect(plan.title).toBe('Task Board Testing');
    expect(plan.url).toBe('/tasks/board');

    const first = plan.tests[0];
    expect(first.scenario).toBe('Create a new task via the Create Task modal');
    expect(first.priority).toBe('critical');
    expect(first.expected).toEqual(['New task card appears in To Do column', 'Success notification is shown']);
    expect(first.plannedSteps).toEqual(['Click Create Task button', 'Fill in Task title', 'Select Assignee', 'Click Save']);
    expect(first.startUrl).toBe('/tasks/board');
  });

  it('passes UI map elements in page_research prompt', async () => {
    await planner.plan();

    const lastReq = mock.getLastRequest();
    expect(lastReq).not.toBeNull();
    const prompt = extractPromptText(lastReq);

    expect(prompt).toContain('<page_research>');
    expect(prompt).toContain('Create Task');
    expect(prompt).toContain('Search tasks');
    expect(prompt).toContain('Filter by assignee');
    expect(prompt).toContain('Create Task Modal');
    expect(prompt).toContain('Filter Dropdown');
  });

  it('injects normal style by default (iteration 0)', async () => {
    await planner.plan();

    const prompt = extractPromptText(mock.getLastRequest());
    expect(prompt).toContain('<approach>');
    expect(prompt).toContain('business purpose');
  });

  it('injects psycho style when overridden', async () => {
    await planner.plan(undefined, 'psycho');

    const prompt = extractPromptText(mock.getLastRequest());
    expect(prompt).toContain('<approach>');
    expect(prompt).toContain('Stress-test');
    expect(prompt).toContain('invalid, empty, or extreme values');
  });

  it('injects feature focus directive in prompt', async () => {
    await planner.plan('search');

    const prompt = extractPromptText(mock.getLastRequest());
    expect(prompt).toContain('focus specifically on: "search"');
    expect(prompt).toContain('FOCUS FILTER: Only propose scenarios using elements relevant to "search"');
    expect(prompt).toContain('Every scenario must focus on: "search"');
  });

  it('includes focused section note when UI map has Focused marker', async () => {
    await planner.plan();

    const prompt = extractPromptText(mock.getLastRequest());
    expect(prompt).toContain('One section is marked as **Focused**');
  });

  it('expands existing plan without duplicating tests', async () => {
    const existingPlan = new Plan('Task Board Testing');
    existingPlan.url = '/tasks/board';
    existingPlan.addTest(new Test('Create a new task via the Create Task modal', 'critical', ['Task appears'], '/tasks/board', ['Click Create']));
    existingPlan.addTest(new Test('Filter tasks by assignee', 'important', ['Filtered list'], '/tasks/board', ['Click filter']));
    existingPlan.addTest(new Test('Delete a task from the board', 'high', ['Task removed'], '/tasks/board', ['Click delete']));

    planner.currentPlan = existingPlan;

    const plan = await planner.plan();

    expect(plan.iteration).toBe(1);
    expect(plan.tests.length).toBe(6);

    const scenarios = plan.tests.map((t) => t.scenario);
    expect(scenarios).toContain('Create a new task via the Create Task modal');
    expect(scenarios).toContain('Search for a task by keyword');
    expect(scenarios).toContain('Switch between Board and List views');
    expect(scenarios).toContain('Apply date range filter and verify results');

    const prompt = extractPromptText(mock.getLastRequest());
    expect(prompt).toContain('CRITICAL: This plan already has tests');
    expect(prompt).toContain('Create a new task via the Create Task modal');
    expect(prompt).toContain('Find a feature area in the research that has NO or minimal test coverage');
  });

  it('keeps feature focus when expanding existing plan', async () => {
    const existingPlan = new Plan('Search Testing');
    existingPlan.url = '/tasks/board';
    existingPlan.addTest(new Test('Search for a task by exact keyword', 'important', ['Results'], '/tasks/board', ['Type keyword']));

    planner.currentPlan = existingPlan;

    await planner.plan('search');

    const prompt = extractPromptText(mock.getLastRequest());
    expect(prompt).toContain('CRITICAL: This plan already has tests');
    expect(prompt).toContain('Stay strictly inside the "search" feature area');
    expect(prompt).toContain('additional scenarios for "search"');
    expect(prompt).not.toContain('Find a feature area in the research that has NO or minimal test coverage');
    expect(prompt).not.toContain('Prioritize testing features from Extended Research that have no coverage yet');
  });

  it('returns cached plan without AI call', async () => {
    const cachedPlan = new Plan('Cached Task Board Plan');
    cachedPlan.url = '/tasks/board';
    cachedPlan.addTest(new Test('Cached test scenario', 'normal', ['Outcome'], '/tasks/board', ['Step']));
    registerPlan('/tasks/board', cachedPlan);

    const plan = await planner.plan();

    expect(plan.tests.length).toBe(1);
    expect(plan.tests[0].scenario).toBe('Cached test scenario');
    expect(mock.getRequests().length).toBe(0);
  });

  it('throws when AI returns empty scenarios and no current plan', async () => {
    mock.clearFixtures();
    mock.on({}, { content: JSON.stringify({ planName: 'Empty', scenarios: [] }) });

    await expect(planner.plan()).rejects.toThrow('No tasks were created successfully');
  });
});
