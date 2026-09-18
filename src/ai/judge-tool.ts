import { tool } from 'ai';
import dedent from 'dedent';
import { z } from 'zod';
import type { ToolDeps } from './agent.ts';
import { failedToolResult, successToolResult } from './tools.ts';

export function createJudgeTool(deps: ToolDeps, buildState: () => Promise<Record<string, unknown>>): Record<string, any> {
  const judge = deps.judge;
  if (!judge?.toolEnabled) return {};

  return {
    judge: tool({
      description: dedent`
        Settle one judgement about the current page and get back a calibrated answer.

        Ask when a decision turns on reading the page rather than on running a command, and you would otherwise
        be guessing. Prefer asking over deciding alone.

        Give options when the answer is one of a known set; leave them out for a yes/no. State the condition
        literally and concretely, naming what you expect to see, rather than in abstract terms — an abstract
        question gets an uncertain answer. Ask one judgement per call.

        Do not ask for anything code can establish exactly, such as whether a URL changed or an element exists.
        Do not ask it to write a locator, a command, or any text — it only picks from the options you gave.

        The reply carries confidence from 0 to 1. Act on a high one. On a low one the page does not separate the
        options: gather more context or take a different route rather than picking anyway.
      `,
      inputSchema: z.object({
        question: z.string().describe('The judgement to settle, written as one complete question or statement about the page'),
        options: z.record(z.string(), z.string()).optional().describe('Option key to its meaning. Omit for a yes/no question'),
        context: z.string().optional().describe('Anything the page observation does not already carry that this judgement needs'),
      }),
      execute: async ({ question, options, context }) => {
        const state = await buildState();
        if (context) state.context = context;

        const answers = await judge.ask(state, { q: { instructions: question, options } });
        if (!answers?.q) {
          return failedToolResult('judge', 'The decision model did not answer.', {
            suggestion: 'Decide with the tools you already have — context(), see(), or an assertion.',
          });
        }

        const { answer, confidence, probabilities } = answers.q;
        return successToolResult('judge', { answer, confidence, probabilities, question });
      },
    }),
  };
}
