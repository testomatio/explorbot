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
        Settle one judgement about the current page instead of guessing. Phrase it literally and concretely.
      `,
      inputSchema: z.object({
        question: z.string().describe('The statement to confirm, or the question the options answer'),
        options: z.array(z.string()).optional().describe('Possible answers. Omit to confirm a statement'),
        context: z.string().optional().describe('Anything the page observation does not already carry'),
      }),
      execute: async ({ question, options, context }) => {
        const state = await buildState();
        if (context) state.context = context;

        const decision = await judge.consult(question, options ?? null, state);
        if (decision.rejected) {
          return failedToolResult('judge', `Not confirmed: ${question}`, {
            suggestion: 'The page does not settle this. Gather more context or take another route; do not assume either answer.',
          });
        }
        return successToolResult('judge', { question, answer: decision.value, confidence: decision.confidence });
      },
    }),
  };
}
