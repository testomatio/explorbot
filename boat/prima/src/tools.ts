import { tool } from 'ai';
import dedent from 'dedent';
import { z } from 'zod';
import { ActionResult } from '../../../src/action-result.ts';
import type { ToolDeps } from '../../../src/ai/agent.ts';
import { commitNote, failedToolResult, successToolResult } from '../../../src/ai/tools.ts';
import { type Task, TestResult } from '../../../src/test-plan.ts';
import { WebElement } from '../../../src/utils/web-element.ts';

const REF_INPUT_DESCRIPTION = 'Ref of the target element, copied exactly as the current page snapshot writes it inside [ref=...]. Use it whenever the snapshot lists one for your target. Only refs from the latest snapshot resolve; never adapt or invent one.';

export async function refToXPath(explorer: any, ref: string): Promise<{ xpath?: string; error?: string }> {
  if (!WebElement.isAriaRef(ref)) return { error: `"${ref}" is not a ref. Pass a ref exactly as the snapshot writes it inside [ref=...], or use commands instead.` };

  const element = await explorer.withPage((page: any) => WebElement.fromAriaRef(page, ref));
  if (!element) return { error: `Ref ${ref} matches no element. It belongs to an older snapshot of this page.` };

  const xpath = element.clickXPath;
  if (!xpath) return { error: `Ref ${ref} resolved to an element with no distinctive attributes to target.` };

  const matches = await explorer.withPage((page: any) => page.locator(`xpath=${xpath}`).count());
  if (matches !== 1) return { error: `Ref ${ref} resolved to ${xpath}, which matches ${matches} elements instead of exactly one.` };

  return { xpath };
}

export function createRefTools({ explorer, stateManager }: ToolDeps, task: Task) {
  const runRef = async (action: 'clickRef' | 'hoverRef', ref: string, explanation: string, toCommand: (xpath: string) => string) => {
    const activeNote = task.startNote(explanation);
    const resolved = await refToXPath(explorer, ref);

    if (resolved.error) {
      activeNote.commit(TestResult.FAILED);
      return failedToolResult(action, resolved.error, {
        suggestion: 'Do not retry with a guessed locator. Take a fresh look at the page and use a ref it lists, or report that the element is not there.',
      });
    }

    const previousState = ActionResult.fromState(stateManager.getCurrentState()!);
    const runner = explorer.action();
    const command = toCommand(resolved.xpath!);
    const success = await runner.attempt(command, explanation);
    const toolResult = await ActionResult.fromState(stateManager.getCurrentState()!).toToolResult(previousState, command);

    if (!success) {
      await commitNote(activeNote, TestResult.FAILED, toolResult, runner);
      return failedToolResult(action, `${command} failed on the element behind ${ref}`, { ...toolResult, code: command }, runner.lastError);
    }

    await commitNote(activeNote, TestResult.PASSED, toolResult, runner);
    return successToolResult(action, { ...toolResult, code: command }, runner);
  };

  return {
    clickRef: tool({
      description: dedent`
        Click the element a page snapshot gave you a ref for.

        Use this whenever the snapshot lists a ref for your target — the ref names that exact
        element, so no locator and no fallback list is needed.
        Use click() instead when you are working from markup that carries no refs.
      `,
      inputSchema: z.object({
        ref: z.string().describe(REF_INPUT_DESCRIPTION),
        explanation: z.string().describe('Why you are clicking this element'),
      }),
      execute: async ({ ref, explanation }) => runRef('clickRef', ref, explanation, (xpath) => `I.click(${JSON.stringify(xpath)})`),
    }),

    hoverRef: tool({
      description: dedent`
        Move the mouse to the element a page snapshot gave you a ref for, to reveal hover-only controls.

        Use this whenever the snapshot lists a ref for your target. It does not click.
        Use hover() instead when you are working from markup that carries no refs.
      `,
      inputSchema: z.object({
        ref: z.string().describe(REF_INPUT_DESCRIPTION),
        explanation: z.string().describe('Why you are hovering this element'),
      }),
      execute: async ({ ref, explanation }) => runRef('hoverRef', ref, explanation, (xpath) => `I.moveCursorTo(${JSON.stringify(xpath)})`),
    }),
  };
}
