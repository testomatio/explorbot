import { describe, expect, it } from 'bun:test';
import { Tester } from '../../src/ai/tester.ts';

function buildTester(pilot: any): any {
  return Object.assign(Object.create(Tester.prototype), {
    pilot,
    pendingReview: '',
    getCurrentState: () => ({ url: '/items' }),
  });
}

function buildTask(): any {
  return {
    hasFinished: false,
    startUrl: '/',
    notes: [] as string[],
    getVisitedUrls: () => [],
    addNote(note: string) {
      this.notes.push(note);
    },
    finish() {
      this.hasFinished = true;
    },
  };
}

describe('Tester defers the Pilot verdict', () => {
  it('does not review finish while the tool batch is still running', async () => {
    let reviewed = false;
    const tester = buildTester({
      reviewFinish: async () => {
        reviewed = true;
      },
    });
    const task = buildTask();

    const tools = tester.createTestFlowTools(task, { url: '/items' }, {});
    const result = await tools.finish.execute({ verify: 'Item Foo is visible in the list' });

    expect(reviewed).toBe(false);
    expect(tester.pendingReview).toBe('finish');
    expect(result.success).toBe(true);
    expect(task.hasFinished).toBe(false);
  });

  it('does not review stop while the tool batch is still running', async () => {
    let reviewed = false;
    const tester = buildTester({
      reviewStop: async () => {
        reviewed = true;
      },
    });
    const task = buildTask();

    const tools = tester.createTestFlowTools(task, { url: '/items' }, {});
    const result = await tools.stop.execute({ reason: 'The feature is absent from this build' });

    expect(reviewed).toBe(false);
    expect(tester.pendingReview).toBe('stop');
    expect(result.success).toBe(true);
    expect(task.hasFinished).toBe(false);
  });

  it('finishes without a Pilot to defer to', async () => {
    const tester = buildTester(null);
    const task = buildTask();

    const tools = tester.createTestFlowTools(task, { url: '/items' }, {});
    await tools.finish.execute({ verify: 'Item Foo is visible in the list' });

    expect(task.hasFinished).toBe(true);
  });
});
