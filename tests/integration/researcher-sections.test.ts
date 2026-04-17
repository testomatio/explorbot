import { createOpenAI } from '@ai-sdk/openai';
import { LLMock } from '@copilotkit/aimock';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { ActionResult } from '../../src/action-result.ts';
import { Provider } from '../../src/ai/provider.ts';
import { clearResearchCache } from '../../src/ai/researcher/cache.ts';
import { Researcher } from '../../src/ai/researcher.ts';
import { ConfigParser } from '../../src/config.ts';

const fakeState = {
  url: '/test/page',
  title: 'Test Page',
  hash: 'section-test-hash',
  html: '<html><body><nav class="nav"><a class="home">Home</a></nav><main class="main"><button>Click me</button></main></body></html>',
  ariaSnapshot: '- navigation:\n  - link "Home"\n- main:\n  - button "Click me"',
};

function createMockExplorer(configOverrides: Record<string, unknown> = {}, playwrightLocatorCount: () => Promise<number> = async () => 0) {
  const baseConfig = ConfigParser.getInstance().getConfig();
  const config = {
    ...baseConfig,
    ai: {
      ...baseConfig.ai,
      agents: {
        ...(baseConfig.ai?.agents as any),
        researcher: {
          ...(baseConfig.ai?.agents as any)?.researcher,
          ...configOverrides,
        },
      },
    },
  };
  const stateManager = {
    getCurrentState: () => fakeState,
    getVisitCount: () => 0,
    getExperienceTracker: () => ({ getSuccessfulExperience: () => [], updateSummary: () => {} }),
    getRelevantKnowledge: () => [],
  };
  return {
    getStateManager: () => stateManager,
    getKnowledgeTracker: () => ({ getRelevantKnowledge: () => [] }),
    getConfig: () => config,
    visit: async () => {},
    annotateElements: async () => [],
    createAction: () => ({
      capturePageState: async () => ActionResult.fromState(fakeState),
      caputrePageWithScreenshot: async () => ActionResult.fromState(fakeState),
    }),
    playwrightLocatorCount,
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

describe('Researcher researchBySections', () => {
  let mock: LLMock;
  let provider: Provider;

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
  });

  afterAll(async () => {
    await mock.stop();
  });

  function makeResearcher(configOverrides: Record<string, unknown> = {}, playwrightLocatorCount: () => Promise<number> = async () => 0): Researcher {
    const explorer = createMockExplorer(configOverrides, playwrightLocatorCount);
    const researcher = new Researcher(explorer, provider);
    researcher.actionResult = ActionResult.fromState(fakeState);
    return researcher;
  }

  it('merges per-section AI responses into one markdown', async () => {
    const researcher = makeResearcher({ sections: ['navigation', 'content'] });
    mock.on({ sequenceIndex: 0 }, { content: "## Navigation\n\n> Container: '.nav'\n\n| Element | ARIA | CSS | eidx |\n| 'Home' | - | 'a.home' | 1 |" });
    mock.on({ sequenceIndex: 1 }, { content: "## Content\n\n> Container: '.main'\n\n| Element | ARIA | CSS | eidx |\n| 'Click me' | - | 'button' | 2 |" });

    const result = await researcher.researchBySections();

    expect(result).toContain('## Navigation');
    expect(result).toContain('## Content');
    expect(result).toContain("'a.home'");
    expect(result).toContain("'button'");
    expect(mock.getRequests().length).toBe(2);
  });

  it('skips sections returning NOT_PRESENT', async () => {
    const researcher = makeResearcher({ sections: ['navigation', 'content'] });
    mock.on({ sequenceIndex: 0 }, { content: 'NOT_PRESENT' });
    mock.on({ sequenceIndex: 1 }, { content: "## Content\n\n> Container: '.main'\n\n| Element | ARIA | CSS | eidx |\n| 'Click' | - | 'button' | 1 |" });

    const result = await researcher.researchBySections();

    expect(result).not.toContain('## Navigation');
    expect(result).not.toContain('NOT_PRESENT');
    expect(result).toContain('## Content');
  });

  it('throws when all sections return NOT_PRESENT', async () => {
    const researcher = makeResearcher({ sections: ['navigation', 'content'] });
    mock.on({ sequenceIndex: 0 }, { content: 'NOT_PRESENT' });
    mock.on({ sequenceIndex: 1 }, { content: 'NOT_PRESENT' });

    await expect(researcher.researchBySections()).rejects.toThrow(/no sections/i);
  });

  it('uses focusSections CSS when Playwright finds a match', async () => {
    const researcher = makeResearcher({ sections: ['navigation', 'content'], focusSections: ['[role="dialog"]'] }, async () => 1);
    mock.on({ sequenceIndex: 0 }, { content: "## Focus\n\n> Container: '[role=\"dialog\"]'\n\n| Element | ARIA | CSS | eidx |\n| 'Close' | - | '[aria-label=\"Close\"]' | 1 |" });

    const result = await researcher.researchBySections();

    expect(mock.getRequests().length).toBe(1);
    expect(result).toContain('## Focus');
    expect(result).toContain('> Focused: Focus');

    const prompt = extractPromptText(mock.getLastRequest());
    expect(prompt).toContain('[role="dialog"]');
  });

  it('skips focusSections when no Playwright match', async () => {
    const researcher = makeResearcher({ sections: ['navigation', 'content'], focusSections: ['[role="dialog"]'] }, async () => 0);
    mock.on({ sequenceIndex: 0 }, { content: "## Navigation\n\n> Container: '.nav'\n\n| Element | ARIA | CSS | eidx |\n| 'Home' | - | 'a.home' | 1 |" });
    mock.on({ sequenceIndex: 1 }, { content: 'NOT_PRESENT' });

    const result = await researcher.researchBySections();

    expect(mock.getRequests().length).toBe(2);
    expect(result).toContain('## Navigation');
    expect(result).not.toContain('> Focused: Focus');
  });
});
