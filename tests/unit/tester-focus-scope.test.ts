import { describe, expect, it } from 'bun:test';
import { ActionResult } from '../../src/action-result.ts';
import { Tester } from '../../src/ai/tester.ts';
import { Test } from '../../src/test-plan.ts';

function buildTester(): Tester {
  const explorer: any = {
    getConfig: () => ({}),
    getStateManager: () => ({
      getExperienceTracker: () => ({
        getExperienceTableOfContents: () => [],
      }),
    }),
    getKnowledgeTracker: () => ({
      getRelevantKnowledge: () => [],
    }),
    getCurrentIframeInfo: () => null,
    hasOtherTabs: () => false,
    getOtherTabsInfo: () => [],
    clearOtherTabsInfo: () => {},
  };
  const provider: any = {};
  const researcher: any = {
    research: async () => '',
    researchOverlay: async () => null,
  };
  const navigator: any = {};
  return new Tester(explorer, provider, researcher, navigator);
}

function buildTesterWithExperience(): Tester {
  const explorer: any = {
    getConfig: () => ({ files: {} }),
    getStateManager: () => ({
      getExperienceTracker: () => ({
        getExperienceTableOfContents: () => [
          {
            fileTag: 'A',
            fileHash: 'abc123',
            url: '/page',
            sections: [{ index: 1, level: 2, title: 'FLOW: create item' }],
          },
        ],
      }),
    }),
    getKnowledgeTracker: () => ({
      getRelevantKnowledge: () => [],
    }),
  };
  const provider: any = {};
  const researcher: any = {};
  const navigator: any = {};
  return new Tester(explorer, provider, researcher, navigator);
}

function buildState(ariaSnapshot: string, url = '/page'): ActionResult {
  return new ActionResult({
    url,
    title: 'Page',
    html: '<html></html>',
    ariaSnapshot,
  });
}

describe('Tester reinjectContextIfNeeded — focus scope hint', () => {
  it('emits <focus_scope> when ARIA snapshot contains a dialog', async () => {
    const tester = buildTester();
    const state = buildState('- dialog "Create Requirement":\n  - tablist:\n    - tab "Text"\n    - tab "File"');

    const context = await (tester as any).reinjectContextIfNeeded(2, state);

    expect(context).toContain('<focus_scope>');
    expect(context).toContain('A dialog "Create Requirement"');
    expect(context).toContain('Scope all interactions to elements inside this dialog');
  });

  it('emits <focus_scope> for alertdialog role', async () => {
    const tester = buildTester();
    const state = buildState('- alertdialog "Confirm Delete":\n  - button "OK"\n  - button "Cancel"');

    const context = await (tester as any).reinjectContextIfNeeded(2, state);

    expect(context).toContain('<focus_scope>');
    expect(context).toContain('A dialog "Confirm Delete"');
  });

  it('omits <focus_scope> when no dialog or modal is open', async () => {
    const tester = buildTester();
    const state = buildState('- main:\n  - button "Save"\n  - button "Cancel"');

    const context = await (tester as any).reinjectContextIfNeeded(2, state);

    expect(context).not.toContain('<focus_scope>');
  });

  it('emits <focus_scope> on URL change as well as same-URL state change', async () => {
    const tester = buildTester();
    const newUrlState = buildState('- dialog "New Form":\n  - textbox "Title"', '/new');

    const context = await (tester as any).reinjectContextIfNeeded(2, newUrlState);

    expect(context).toContain('<focus_scope>');
    expect(context).toContain('A dialog "New Form"');
  });
});

describe('Tester experience context', () => {
  it('adds only the experience table of contents to the scenario prompt', () => {
    const tester = buildTesterWithExperience();
    const task = new Test('create item', 'normal', 'item exists', '/page');
    const state = buildState('- main:', '/page');

    const scenarioBlock = (tester as any).buildScenarioBlock(task, state);

    expect(scenarioBlock).toContain('<experience>');
    expect(scenarioBlock).toContain('A.1 ## FLOW: create item');
    expect(scenarioBlock).toContain('Call learnExperience({ fileTag, sectionIndex })');
    expect(scenarioBlock).not.toContain('I.click');
    expect(scenarioBlock).not.toContain('```');
  });
});
