import { beforeEach, describe, expect, it } from 'bun:test';
import { Decision } from '../../src/ai/judge.ts';
import { Pilot } from '../../src/ai/pilot.ts';
import { Stats } from '../../src/stats.ts';
import { Test, TestResult } from '../../src/test-plan.ts';

function buildPilot(provider: any, judge?: any): Pilot {
  return Object.assign(Object.create(Pilot.prototype), { provider, judge }) as Pilot;
}

function finalPage(): any {
  return { screenshot: Buffer.from('fake-png') };
}

describe('Pilot settling outcomes against the final page', () => {
  beforeEach(() => {
    Stats.visionDisabled = false;
  });

  it('judges every outcome against the screenshot, including one the run already checked off', async () => {
    const models: any[] = [];
    const contents: any[] = [];
    const pilot = buildPilot({
      hasVision: () => true,
      getVisionModel: () => 'vision-model',
      getAgenticModel: () => 'text-model',
      generateObject: async (messages: any[], _schema: any, model: any) => {
        models.push(model);
        contents.push(messages[0].content);
        return { object: { outcomes: [{ expectation: 'the editor opens', status: 'failed' }] } };
      },
    });

    const task = new Test('open the editor', 'normal', ['the editor opens'], '/skills');
    task.addNote('the editor opens', TestResult.PASSED);

    const settled = await pilot.settleExpectations(task, finalPage());

    expect(settled).toEqual([{ text: 'the editor opens', status: 'failed' }]);
    expect(models).toEqual(['vision-model']);
    expect(contents[0].some((part: any) => part.type === 'file')).toBe(true);
  });

  it('passes a contradiction between the picture and the run straight through with its evidence', async () => {
    const pilot = buildPilot({
      hasVision: () => true,
      getVisionModel: () => 'vision-model',
      getAgenticModel: () => 'text-model',
      generateObject: async () => ({
        object: {
          outcomes: [{ expectation: 'the new row is listed', status: 'contradiction', evidence: 'the assertion found the row in the page structure; the screenshot shows an empty list' }],
        },
      }),
    });

    const task = new Test('add a row', 'normal', ['the new row is listed'], '/rows');
    task.addNote('the new row is listed', TestResult.PASSED);

    const settled = await pilot.settleExpectations(task, finalPage());

    expect(settled[0].status).toBe('contradiction');
    expect(settled[0].evidence).toContain('screenshot shows an empty list');
  });

  it('settles from the run log alone when the vision model cannot judge', async () => {
    const models: any[] = [];
    const pilot = buildPilot({
      hasVision: () => true,
      getVisionModel: () => 'vision-model',
      getAgenticModel: () => 'text-model',
      generateObject: async (_messages: any[], _schema: any, model: any) => {
        models.push(model);
        if (model === 'vision-model') throw new Error('vision model rejected the schema');
        return { object: { outcomes: [{ expectation: 'the editor opens', status: 'passed' }] } };
      },
    });

    const task = new Test('open the editor', 'normal', ['the editor opens'], '/skills');
    task.addNote('Editor panel appeared with the markdown loaded', TestResult.PASSED);

    const settled = await pilot.settleExpectations(task, finalPage());

    expect(settled).toEqual([{ text: 'the editor opens', status: 'passed' }]);
    expect(models).toEqual(['vision-model', 'text-model']);
    expect(Stats.visionDisabled).toBe(true);
  });

  it('does not reach for vision when the run left no screenshot', async () => {
    const models: any[] = [];
    const pilot = buildPilot({
      hasVision: () => true,
      getVisionModel: () => 'vision-model',
      getAgenticModel: () => 'text-model',
      generateObject: async (_messages: any[], _schema: any, model: any) => {
        models.push(model);
        return { object: { outcomes: [{ expectation: 'the list refreshes', status: 'unverified' }] } };
      },
    });

    const task = new Test('open the editor', 'normal', ['the list refreshes'], '/skills');
    task.addNote('Clicked around the sidebar', TestResult.PASSED);

    const settled = await pilot.settleExpectations(task);

    expect(settled).toEqual([{ text: 'the list refreshes', status: 'unverified' }]);
    expect(models).toEqual(['text-model']);
  });
});

describe('Pilot settling outcomes via the judge', () => {
  const judgeHappened = (settles: string) => ({
    decide: async (question: string, options: string[]) => {
      if (!question.includes(settles)) return new Decision(null, 0.5);
      return new Decision(options[0], 0.9);
    },
  });

  it('settles what the judge approves and leaves the rest to the model', async () => {
    const asked: string[] = [];
    const pilot = buildPilot(
      {
        hasVision: () => false,
        getAgenticModel: () => 'text-model',
        generateObject: async (messages: any[]) => {
          asked.push(messages[0].content);
          return { object: { outcomes: [{ expectation: 'the list refreshes', status: 'failed' }] } };
        },
      },
      judgeHappened('the editor opens')
    );

    const settled = await pilot.settleExpectations(new Test('open the editor', 'normal', ['the editor opens', 'the list refreshes'], '/skills'));

    expect(settled).toEqual([
      { text: 'the editor opens', status: 'passed' },
      { text: 'the list refreshes', status: 'failed' },
    ]);
    expect(asked).toHaveLength(1);
    expect(asked[0]).not.toContain('the editor opens');
  });

  it('does not ask the model when the judge settles every outcome', async () => {
    let modelAsked = false;
    const pilot = buildPilot(
      {
        hasVision: () => false,
        generateObject: async () => {
          modelAsked = true;
          return null;
        },
      },
      judgeHappened('the editor opens')
    );

    const settled = await pilot.settleExpectations(new Test('open the editor', 'normal', ['the editor opens'], '/skills'));

    expect(settled).toEqual([{ text: 'the editor opens', status: 'passed' }]);
    expect(modelAsked).toBe(false);
  });
});

describe('Pilot resolving a contradiction from the page structure', () => {
  const contradicted = () => ({
    hasVision: () => true,
    getVisionModel: () => 'vision-model',
    getAgenticModel: () => 'text-model',
    generateObject: async () => ({
      object: { outcomes: [{ expectation: 'the alert is shown', status: 'contradiction', evidence: 'the run did not find the alert text; the screenshot shows the alert' }] },
    }),
  });
  const pageWithAria = (): any => ({ screenshot: Buffer.from('fake-png'), getCompactARIA: () => '- paragraph: Access is limited to trusted networks' });
  const judgePicking = (fragment: string | null) => ({
    decide: async (_question: string, options: string[], state: any) => {
      judged.push(state);
      return new Decision(options.find((option) => fragment && option.includes(fragment)) || null, 0.9);
    },
  });
  let judged: any[] = [];

  beforeEach(() => {
    judged = [];
    Stats.visionDisabled = false;
  });

  function addAlertTask(): Test {
    const task = new Test('see the alert', 'normal', ['the alert is shown'], '/projects');
    task.addNote('the alert is shown', TestResult.FAILED);
    return task;
  }

  it('settles the outcome when the page structure agrees with the screenshot', async () => {
    const pilot = buildPilot(contradicted(), judgePicking('outcome happened'));

    const settled = await pilot.settleExpectations(addAlertTask(), pageWithAria());

    expect(settled[0].status).toBe('passed');
    expect(settled[0].resolution).toContain('run log was wrong');
    expect(settled[0].evidence).toContain('screenshot shows the alert');
    expect(judged[0].page).toContain('trusted networks');
    expect(judged[0].disagreement).toContain('did not find the alert text');
  });

  it('keeps the contradiction and names a rendering problem when the page structure agrees with the run', async () => {
    const pilot = buildPilot(contradicted(), judgePicking('agrees with the run log'));

    const settled = await pilot.settleExpectations(addAlertTask(), pageWithAria());

    expect(settled[0].status).toBe('contradiction');
    expect(settled[0].resolution).toContain('does not display it');
  });

  it('keeps the contradiction untouched when the judge cannot decide', async () => {
    const pilot = buildPilot(contradicted(), judgePicking(null));

    const settled = await pilot.settleExpectations(addAlertTask(), pageWithAria());

    expect(settled[0].status).toBe('contradiction');
    expect(settled[0].resolution).toBeUndefined();
  });
});
