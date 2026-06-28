import { describe, expect, it } from 'bun:test';
import { ActionResult } from '../../src/action-result.ts';
import { Tester } from '../../src/ai/tester.ts';

function buildTester(experienceToc: any[] = []): Tester {
  const explorer: any = {
    getConfig: () => ({}),
    getCurrentIframeInfo: () => null,
    hasOtherTabs: () => false,
    getOtherTabsInfo: () => [],
    clearOtherTabsInfo: () => {},
    getStateManager: () => ({
      getExperienceTracker: () => ({
        getExperienceTableOfContents: () => experienceToc,
      }),
      getCurrentState: () => buildState('- main:', '/page'),
    }),
  };
  const provider: any = {
    getSystemPromptForAgent: () => '',
  };
  const researcher: any = {
    research: async () => '',
    researchOverlay: async () => null,
  };
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
  it('instructs tester to put matching experience commands first', () => {
    const tester = buildTester();
    const system = (tester as any).getSystemMessage();

    expect(system).toContain('put that saved command FIRST');
    expect(system).toContain('Add new fallback locators only after the saved command');
  });

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

  it('emits experience TOC on URL change', async () => {
    const tester = buildTester([
      {
        fileTag: 'A',
        fileHash: 'page',
        url: '/page',
        sections: [{ index: 1, level: 2, title: 'FLOW: create item' }],
      },
    ]);
    const state = buildState('- main:\n  - button "Create"', '/with-experience');

    const context = await (tester as any).reinjectContextIfNeeded(2, state);

    expect(context).toContain('<experience>');
    expect(context).toContain('A.1 ## FLOW: create item');
    expect(context).toContain('Call learnExperience');
  });
});
