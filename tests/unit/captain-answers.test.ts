import { describe, expect, it } from 'bun:test';
import { Captain } from '../../src/ai/captain.ts';
import { startAnswerCapture, tag } from '../../src/utils/logger.ts';

function buildCaptain(reply: string, answers: Array<{ state: any; question: string; answer: string }>) {
  const written: Array<{ url: string; body: string }> = [];
  const prompts: string[] = [];

  const experienceTracker = {
    takeAnswers: () => answers.splice(0, answers.length),
    getRelevantExperience: () => [],
    writeFlow: (state: any, body: string) => written.push({ url: state.url, body }),
  };

  const provider = {
    getModelForAgent: () => 'model',
    chat: async (messages: any[]) => {
      prompts.push(messages[messages.length - 1].content);
      return { text: reply };
    },
  };

  const captain = Object.assign(Object.create(Captain.prototype), {
    experienceTracker,
    explorBot: { experienceTracker: () => experienceTracker, getProvider: () => provider },
  }) as Captain;

  return { captain, written, prompts };
}

describe('Captain reviewAnswers', () => {
  it('keeps the answer verbatim under the how-to the model judged it worth', async () => {
    const { captain, written } = buildCaptain('sign in as the owner', [{ state: { url: '/login' }, question: 'How do I authorize?', answer: 'owner@example.org / hunter2' }]);

    await captain.reviewAnswers();

    expect(written).toEqual([{ url: '/login', body: '## FLOW: sign in as the owner\n\n* How do I authorize?\n* owner@example.org / hunter2\n\n---\n' }]);
  });

  it('writes nothing when the model judges the answer not worth keeping', async () => {
    const { captain, written } = buildCaptain('', [{ state: { url: '/defects' }, question: 'Which row should I open?', answer: 'the second one' }]);

    await captain.reviewAnswers();

    expect(written).toEqual([]);
  });

  it('does not reach the model when no answer was collected', async () => {
    const { captain, prompts } = buildCaptain('never asked', []);

    await captain.reviewAnswers();

    expect(prompts).toEqual([]);
  });

  it('reviews the answer against the log that followed it', async () => {
    startAnswerCapture();
    tag('step').log("I.fillField('#email', 'owner@example.org')");
    const { captain, prompts } = buildCaptain('', [{ state: { url: '/login' }, question: 'How do I authorize?', answer: 'owner@example.org / hunter2' }]);

    await captain.reviewAnswers();

    expect(prompts[0]).toContain("I.fillField('#email', 'owner@example.org')");
  });
});
