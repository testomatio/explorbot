import { describe, expect, it } from 'bun:test';
import { ActionResult } from '../../src/action-result.ts';
import { Tester } from '../../src/ai/tester.ts';
import { renderExperienceToc } from '../../src/experience-tracker.ts';
import { Test, TestResult } from '../../src/test-plan.ts';

function buildTester(): Tester {
  const provider: any = {
    getSystemPromptForAgent: () => '',
  };
  const researcher: any = {
    research: async () => '',
    researchOverlay: async () => null,
  };
  const navigator: any = {};
  const deps: any = {
    explorer: {},
    ai: provider,
    config: {},
    stateManager: {
      getCurrentState: () => null,
      otherTabs: [],
      getExperienceTracker: () => ({
        getExperienceTableOfContents: () => [],
        renderExperienceFor: () => '',
        renderExperienceTocFor: () => '',
      }),
    },
    knowledgeTracker: {
      getRelevantKnowledge: () => [],
      renderRelevantKnowledge: () => '',
      renderRelevantContext: () => '',
    },
    requestStore: { clear: () => {}, onFailedRequest: () => () => {}, getFailedRequests: () => [] },
    playwrightRecorder: {},
  };
  return new Tester(deps, researcher, navigator);
}

function buildTesterWithExperience(): Tester {
  const experienceToc = [
    {
      fileTag: 'A',
      fileHash: 'abc123',
      url: '/page',
      sections: [{ index: 1, level: 2, title: 'FLOW: create item' }],
    },
  ];
  const provider: any = {};
  const researcher: any = {};
  const navigator: any = {};
  const deps: any = {
    explorer: {},
    ai: provider,
    config: { files: {} },
    stateManager: {
      otherTabs: [],
      getExperienceTracker: () => ({
        getExperienceTableOfContents: () => experienceToc,
        renderExperienceFor: () => '',
        renderExperienceTocFor: () => renderExperienceToc(experienceToc),
      }),
    },
    knowledgeTracker: {
      getRelevantKnowledge: () => [],
      renderRelevantKnowledge: () => '',
      renderRelevantContext: () => '',
    },
    requestStore: { clear: () => {}, onFailedRequest: () => () => {}, getFailedRequests: () => [] },
    playwrightRecorder: {},
  };
  return new Tester(deps, researcher, navigator);
}

function buildState(ariaSnapshot: string, url = '/page'): ActionResult {
  return new ActionResult({
    url,
    title: 'Page',
    html: '<html></html>',
    ariaSnapshot,
  });
}

describe('Tester evidence rules', () => {
  it('accepts explicit URL filter state and rejects inferred validation associations', () => {
    const prompt = buildTester().getSystemMessage();

    expect(prompt).toContain('selected control, URL/query, or another explicit state indicator');
    expect(prompt).toContain('finish the scenario instead of repeating the interaction');
    expect(prompt).toContain('Do not infer the affected field from DOM order or proximity alone');
  });
});

describe('Tester reinjectContextIfNeeded — focus scope hint', () => {
  it('emits <overlay> when ARIA snapshot contains a dialog', async () => {
    const tester = buildTester();
    const state = buildState('- dialog "Create Requirement":\n  - tablist:\n    - tab "Text"\n    - tab "File"');

    const context = await (tester as any).reinjectContextIfNeeded(2, state);

    expect(context).toContain('<overlay>');
    expect(context).toContain('An overlay "Create Requirement"');
    expect(context).toContain('Scope all interactions to elements inside this overlay');
  });

  it('emits <overlay> for alertdialog role', async () => {
    const tester = buildTester();
    const state = buildState('- alertdialog "Confirm Delete":\n  - button "OK"\n  - button "Cancel"');

    const context = await (tester as any).reinjectContextIfNeeded(2, state);

    expect(context).toContain('<overlay>');
    expect(context).toContain('An overlay "Confirm Delete"');
  });

  it('omits <overlay> when no dialog or modal is open', async () => {
    const tester = buildTester();
    const state = buildState('- main:\n  - button "Save"\n  - button "Cancel"');

    const context = await (tester as any).reinjectContextIfNeeded(2, state);

    expect(context).not.toContain('<overlay>');
  });

  it('emits <overlay> on URL change as well as same-URL state change', async () => {
    const tester = buildTester();
    const newUrlState = buildState('- dialog "New Form":\n  - textbox "Title"', '/new');

    const context = await (tester as any).reinjectContextIfNeeded(2, newUrlState);

    expect(context).toContain('<overlay>');
    expect(context).toContain('An overlay "New Form"');
  });
});

describe('Tester research failures', () => {
  it('keeps the scenario running when page research fails, reporting it as a warning', async () => {
    const tester = buildTester();
    (tester as any).researcher.research = async () => {
      throw new Error('Please reduce the length of the messages or completion.');
    };
    const state = buildState('- main:\n  - button "Save"', '/page');

    const context = await (tester as any).reinjectContextIfNeeded(2, state);

    expect(context).toContain('CURRENT URL: /page');
    expect(context).not.toContain('</page_ui_map>');
  });

  it('keeps the scenario running when overlay research fails', async () => {
    const tester = buildTester();
    (tester as any).researcher.researchOverlay = async () => {
      throw new Error('Please reduce the length of the messages or completion.');
    };
    await (tester as any).reinjectContextIfNeeded(1, buildState('- main:', '/page'));

    const context = await (tester as any).reinjectContextIfNeeded(2, buildState('- dialog "Select folder":\n  - button "OK"', '/page'));

    expect(context).toContain('<overlay>');
    expect(context).not.toContain('</page_ui_map_overlay>');
  });

  it('still aborts the scenario when research is interrupted', async () => {
    const tester = buildTester();
    (tester as any).researcher.research = async () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    };
    const state = buildState('- main:', '/page');

    await expect((tester as any).reinjectContextIfNeeded(2, state)).rejects.toThrow('aborted');
  });
});

describe('Tester experience context', () => {
  it('keeps recorded experience out of the scenario prompt, so only what the Pilot forwards reaches it', () => {
    const tester = buildTesterWithExperience();
    const task = new Test('create item', 'normal', 'item exists', '/page');
    const state = buildState('- main:', '/page');

    const scenarioBlock = (tester as any).buildScenarioBlock(task, state);

    expect(scenarioBlock).not.toContain('<experience>');
    expect(scenarioBlock).not.toContain('FLOW: create item');
    expect(scenarioBlock).not.toContain('learnExperience');
  });
});

describe('Tester stalled execution', () => {
  it('hands a stalled scenario to final review without deciding the verdict itself', () => {
    const tester = buildTester();
    const task = new Test('filter items', 'normal', 'filtered items appear', '/page');
    const state = buildState('- main:', '/page');
    (tester as any).stateManager.getCurrentState = () => state;

    expect((tester as any).shouldStopForStalledExecution(task, state, [])).toBe(false);
    expect((tester as any).shouldStopForStalledExecution(task, state, [])).toBe(false);
    expect((tester as any).shouldStopForStalledExecution(task, state, [])).toBe(true);
    expect(task.hasFinished).toBe(false);
    expect(task.result).toBe(null);
    expect(task.getPrintableNotes()).toContain('No further browser progress on unchanged page; requesting final review');
  });

  it('hands repeated execution errors to final review without marking the test failed', () => {
    const tester = buildTester();
    const task = new Test('filter items', 'normal', 'filtered items appear', '/page');

    expect((tester as any).shouldStopAfterStalledLoopError(task)).toBe(false);
    expect((tester as any).shouldStopAfterStalledLoopError(task)).toBe(false);
    expect((tester as any).shouldStopAfterStalledLoopError(task)).toBe(true);
    expect(task.hasFinished).toBe(false);
    expect(task.result).toBe(null);
  });
});

describe('Tester verdict', () => {
  it('passes a test whose expectations were all achieved, instead of leaving it without a result', () => {
    const tester = buildTester();
    const task = new Test('filter items', 'normal', ['filtered items appear', 'the count updates'], '/page');
    task.addNote('filtered items appear', TestResult.PASSED);
    task.addNote('the count updates', TestResult.PASSED);

    (tester as any).finishTest(task);

    expect(task.result).toBe(TestResult.PASSED);
    expect(task.isSuccessful).toBe(true);
  });

  it('fails a test that stopped without achieving every expectation', () => {
    const tester = buildTester();
    const task = new Test('filter items', 'normal', ['filtered items appear', 'the count updates'], '/page');
    task.addNote('filtered items appear', TestResult.PASSED);

    (tester as any).finishTest(task);

    expect(task.result).toBe(TestResult.FAILED);
  });
});

describe('Tester step instructions', () => {
  it('keeps the rules once the log has entries, instead of replacing them with it', async () => {
    const tester = buildTester();
    const task = new Test('filter items', 'normal', ['filtered items appear'], '/page');
    task.addNote('clicked the filter button');

    const instructions = await (tester as any).prepareInstructionsForNextStep(task);

    expect(instructions).toContain('Do not run same tool calls with same parameters again');
    expect(instructions).toContain('clicked the filter button');
    expect(instructions).toContain('filtered items appear');
  });
});
