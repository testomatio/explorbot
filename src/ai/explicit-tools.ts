import { tool } from 'ai';
import dedent from 'dedent';
import { z } from 'zod';
import { ActionResult } from '../action-result.ts';
import { Stats } from '../stats.ts';
import { type Task, TestResult } from '../test-plan.js';
import type { ToolDeps } from './agent.ts';
import type { Researcher } from './researcher.ts';
import { clickFailureSuggestion, commitNote, errorText, failedToolResult, hasObservablePageChange, successToolResult, throwIfFatalBrowserError } from './tools.ts';

export const EXPLICIT_TOOL_NAMES = ['dragAndDrop', 'rightClick'] as const;

interface ExplicitToolDeps extends ToolDeps {
  researcher?: Researcher;
}

export function createExplicitTools({ explorer, stateManager, judge, researcher }: ExplicitToolDeps, task: Task): Record<string, any> {
  return {
    dragAndDrop: tool({
      description: dedent`
        Drag something on the page and drop it somewhere else: reorder list or tree items, move cards
        between columns, drop into folders or zones, drag slider handles, draw on a canvas.

        Give visual descriptions of what to grab and where to drop it — the tool locates both points
        on the screenshot and drags between them with a real mouse. When items look alike, describe
        the position (e.g. "the second card in the first column"). For a copy-drag that duplicates
        the item, pass modifier.
      `,
      inputSchema: z.object({
        from: z.string().describe('What to drag, by visible appearance and position (e.g. "card labeled Bug 5 in the first column", "round handle of the volume slider")'),
        to: z.string().describe('Where to drop it, by visible appearance and position (e.g. "column labeled Done", "right end of the volume slider track")'),
        modifier: z.enum(['Control', 'Shift', 'Alt', 'Meta', 'CommandOrControl']).optional().describe('Modifier key held during the whole drag, e.g. Control for a copy-drag that duplicates the item.'),
        explanation: z.string().describe('Why you are dragging this element'),
      }),
      execute: async ({ from, to, modifier, explanation }) => {
        const activeNote = task.startNote(explanation);

        if (!researcher || Stats.visionDisabled) {
          activeNote.commit(TestResult.FAILED);
          return failedToolResult('dragAndDrop', 'Drag points cannot be located in this session. Use form() with I.dragAndDrop(source, target) instead.');
        }

        try {
          const captured = await explorer.capture({ screenshot: true });

          if (!captured.screenshot) {
            activeNote.commit(TestResult.FAILED);
            return failedToolResult('dragAndDrop', 'Failed to capture screenshot for locating the drag points');
          }

          const analysis = await researcher.checkDragPoints(captured, from, to);

          if (!analysis) {
            activeNote.commit(TestResult.FAILED);
            return failedToolResult('dragAndDrop', 'Visual analysis failed to process the screenshot');
          }

          const points = dragPoints(analysis);

          if (!points) {
            activeNote.commit(TestResult.FAILED);
            return failedToolResult('dragAndDrop', `Drag points not found: ${analysis}`, {
              analysis,
              suggestion: 'Describe what to drag and where to drop it more precisely, or scroll the target into view and retry.',
            });
          }

          const previousState = ActionResult.fromState(stateManager.getCurrentState()!);
          const action = explorer.action();
          const dragCode = mouseDragCode(from, to, points);
          const block = withModifier(dragCode, modifier);
          const attempts: Array<{ command: string; success: boolean; error?: string }> = [];

          const mouseSuccess = await action.attempt(block, explanation);
          const attempt: { command: string; success: boolean; error?: string } = { command: dragCode, success: mouseSuccess };
          if (!mouseSuccess && action.lastError) attempt.error = errorText(action.lastError);
          attempts.push(attempt);

          if (mouseSuccess) {
            const toolResult = await ActionResult.fromState(stateManager.getCurrentState()!).toToolResult(previousState, dragCode);

            if (hasObservablePageChange(toolResult)) {
              await commitNote(activeNote, TestResult.PASSED, toolResult, action);
              return successToolResult('dragAndDrop', { ...toolResult, points, analysis, attempts, code: block }, action);
            }
          }
          await releaseModifier(action, modifier);

          const dragged = await syntheticDragDrop(explorer, points, modifier);
          attempts.push({ command: `${dragCode} (HTML5 drag events)`, success: dragged });

          if (dragged) {
            await explorer.capture();
            const toolResult = await ActionResult.fromState(stateManager.getCurrentState()!).toToolResult(previousState, dragCode);

            if (hasObservablePageChange(toolResult)) {
              await commitNote(activeNote, TestResult.PASSED, toolResult, action);
              return successToolResult('dragAndDrop', { ...toolResult, points, analysis, attempts, code: block, message: 'The drop landed only after HTML5 drag events were dispatched at the located points; the recorded mouse drag replays through the tool, which runs the same escalation.' }, action);
            }
          }

          const toolResult = await ActionResult.fromState(stateManager.getCurrentState()!).toToolResult(previousState, dragCode);
          await commitNote(activeNote, TestResult.FAILED, toolResult, action);
          return failedToolResult(
            'dragAndDrop',
            'The drag changed nothing on the page',
            {
              ...toolResult,
              points,
              analysis,
              attempts,
              suggestion: 'Check that what you described is draggable and the target is a valid drop zone. When a drag starts from a handle, describe the handle as the grab point, not the whole card.',
            },
            action.lastError,
            judge,
            explanation
          );
        } catch (error) {
          throwIfFatalBrowserError(error);
          activeNote.commit(TestResult.FAILED);
          return failedToolResult('dragAndDrop', `dragAndDrop tool failed: ${errorText(error)}`);
        }
      },
    }),

    rightClick: tool({
      description: dedent`
        Right-click an element to open its context menu, then act on the menu items it reveals.

        This tool ONLY accepts I.rightClick() commands. After the menu opens, click its items
        with click() — the menu is not part of this tool.
      `,
      inputSchema: z.object({
        commands: z.array(z.string()).describe(dedent`
          FALLBACK LOCATORS for ONE element. All commands must right-click the SAME element.
          Order by reliability:
          1. I.rightClick(text, container)
          2. I.rightClick(ARIA, container)
          3. I.rightClick(CSS, container)
          4. I.rightClick(CSS) or I.rightClick(XPath)
        `),
        explanation: z.string().describe('Why you are right-clicking this element'),
      }),
      execute: async ({ commands: rawCommands, explanation }) => {
        const activeNote = task.startNote(explanation);

        if (rawCommands.length === 0) {
          activeNote.commit(TestResult.FAILED);
          return failedToolResult('rightClick', 'No commands provided');
        }

        const invalidCommands = rawCommands.map((cmd) => cmd.trim()).filter((cmd) => cmd.startsWith('I.') && !cmd.startsWith('I.rightClick'));

        if (invalidCommands.length > 0) {
          activeNote.commit(TestResult.FAILED);
          return failedToolResult('rightClick', `Invalid commands: ${invalidCommands.join(', ')}. rightClick tool only accepts I.rightClick() commands.`, {
            suggestion: 'Use click() for normal clicks, or form() for multiple actions.',
          });
        }

        const commands = rawCommands.map((cmd) => {
          const trimmed = cmd.trim();
          if (trimmed.startsWith('I.rightClick')) return trimmed;
          return `I.rightClick(${JSON.stringify(trimmed)})`;
        });

        const previousState = ActionResult.fromState(stateManager.getCurrentState()!);
        const action = explorer.action();
        const attempts: Array<{ command: string; success: boolean; error?: string }> = [];

        for (const command of commands) {
          const success = await action.attempt(command, explanation);
          const attempt: { command: string; success: boolean; error?: string } = { command, success };
          if (action.lastError) attempt.error = errorText(action.lastError);
          attempts.push(attempt);

          if (!success) continue;

          const toolResult = await ActionResult.fromState(stateManager.getCurrentState()!).toToolResult(previousState, command);

          if (!hasObservablePageChange(toolResult)) {
            activeNote.commit(TestResult.FAILED);
            return failedToolResult('rightClick', 'Right-click executed, but no context menu appeared.', {
              ...toolResult,
              attempts,
              code: command,
              suggestion: 'Treat the element as not right-clickable. It may not attach a context menu, or the menu opens on hover instead.',
            });
          }

          await commitNote(activeNote, TestResult.PASSED, toolResult, action);
          return successToolResult('rightClick', { ...toolResult, attempts, code: command }, action);
        }

        const toolResult = await ActionResult.fromState(stateManager.getCurrentState()!).toToolResult(previousState, commands[0]);
        await commitNote(activeNote, TestResult.FAILED, toolResult, action);
        return failedToolResult(
          'rightClick',
          'All right-click commands failed',
          {
            ...toolResult,
            attempts,
            suggestion: clickFailureSuggestion(attempts),
          },
          action.lastError,
          judge,
          explanation
        );
      },
    }),
  };
}

export function normalizeExplicitTools(names: string[]): string[] {
  const canonical = names.map((name) => EXPLICIT_TOOL_NAMES.find((known) => known.toLowerCase() === name.trim().toLowerCase())).filter(Boolean) as string[];
  return [...new Set(canonical)];
}

export function parseExplicitToolsRequest(text: string): string[] {
  const match = text.match(/^ENABLE_TOOLS:\s*([A-Za-z, ]+)$/m);
  if (!match) return [];
  return normalizeExplicitTools(match[1].split(','));
}

function withModifier(command: string, modifier?: string): string {
  if (!modifier) return command;
  return `I.pressKeyDown(${JSON.stringify(modifier)})\n${command}\nI.pressKeyUp(${JSON.stringify(modifier)})`;
}

async function releaseModifier(action: any, modifier?: string): Promise<void> {
  if (!modifier) return;
  await action.attempt(`I.pressKeyUp(${JSON.stringify(modifier)})`, `Release the ${modifier} key left held by a failed drag`);
}

const SYNTHETIC_MODIFIER_KEYS: Record<string, string> = { Control: 'ctrlKey', Shift: 'shiftKey', Alt: 'altKey', Meta: 'metaKey', CommandOrControl: 'auto' };

export function dragPoints(analysis: string): DragPoints | null {
  const match = analysis.match(/grab\s+(\d+)X,\s*(\d+)Y.*?drop\s+(\d+)X,\s*(\d+)Y/is);
  if (!match) return null;
  return {
    from: { x: Number.parseInt(match[1], 10), y: Number.parseInt(match[2], 10) },
    to: { x: Number.parseInt(match[3], 10), y: Number.parseInt(match[4], 10) },
  };
}

function mouseDragCode(from: string, to: string, points: DragPoints): string {
  const { x: fx, y: fy } = points.from;
  const { x: tx, y: ty } = points.to;
  return `I.usePlaywrightTo(${JSON.stringify(`drag ${from} to ${to}`)}, async ({ page }) => { await page.mouse.move(${fx}, ${fy}); await page.mouse.down(); await page.waitForTimeout(200); await page.mouse.move(${tx}, ${ty}, { steps: 10 }); await page.waitForTimeout(200); await page.mouse.up(); })`;
}

export async function syntheticDragDrop(explorer: any, points: DragPoints, modifier?: string): Promise<boolean> {
  const modifierKey = modifier ? SYNTHETIC_MODIFIER_KEYS[modifier] : undefined;
  return explorer
    .withPage(async (page: any) =>
      page.evaluate(
        ({ from, to, modifierKey }: { from: { x: number; y: number }; to: { x: number; y: number }; modifierKey?: string }) => {
          const startEl = document.elementFromPoint(from.x, from.y);
          const endEl = document.elementFromPoint(to.x, to.y);
          if (!startEl || !endEl) return false;
          const key = modifierKey === 'auto' ? (navigator.platform.includes('Mac') ? 'metaKey' : 'ctrlKey') : modifierKey;
          const dataTransfer = new DataTransfer();
          const fire = (el: Element, type: string, at: { x: number; y: number }) => {
            const init: any = { bubbles: true, cancelable: true, dataTransfer, clientX: at.x, clientY: at.y };
            if (key) init[key] = true;
            el.dispatchEvent(new DragEvent(type, init));
          };
          fire(startEl, 'dragstart', from);
          fire(endEl, 'dragenter', to);
          fire(endEl, 'dragover', to);
          fire(endEl, 'drop', to);
          fire(startEl, 'dragend', from);
          return true;
        },
        { from: points.from, to: points.to, modifierKey }
      )
    )
    .catch(() => false);
}

export interface DragPoints {
  from: { x: number; y: number };
  to: { x: number; y: number };
}
