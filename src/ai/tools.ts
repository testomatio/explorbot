import { tool } from 'ai';
import dedent from 'dedent';
import { z } from 'zod';
import { ActionResult, type ToolResultMetadata } from '../action-result.ts';
import type Explorer from '../explorer.ts';
import { type Task, TestResult } from '../test-plan.js';
import { extractFocusedElement } from '../utils/aria.ts';
import { createDebug, tag } from '../utils/logger.js';
import { pause } from '../utils/loop.js';
import { WebElement } from '../utils/web-element.ts';
import { Navigator } from './navigator.ts';
import { Researcher } from './researcher.ts';
import { sectionContextRule } from './rules.ts';
import { isInteractive } from './task-agent.ts';

const debugLog = createDebug('explorbot:tools');

export const CODECEPT_TOOLS = ['click', 'pressKey', 'form'] as const;
export const ASSERTION_TOOLS = ['verify'] as const;

export function createCodeceptJSTools(explorer: Explorer, task: Task) {
  const stateManager = explorer.getStateManager();

  return {
    click: tool({
      description: dedent`
        Click an element by trying multiple CodeceptJS commands in order until one succeeds.

        Follow <locator_priority> from system prompt for locator selection.

        I.click(locator) - click element matching locator
        I.click(locator, container) - click element inside a parent element (CSS selector)
          Container narrows search area. Use when page has multiple matching elements.
          Example: Page has 3 "Delete" buttons in different rows:
          I.click("Delete", ".row-1") - clicks Delete inside element with class row-1

        IMPORTANT: This tool ONLY accepts click commands. For typing text, use form() tool.
      `,
      inputSchema: z.object({
        commands: z.array(z.string()).describe(dedent`
          Order by reliability:
          1. I.click(text, container) - PREFERRED when container is known - e.g. I.click("Save", ".modal")
          2. I.click(ARIA, container) - e.g. I.click({"role":"button","text":"Save"}, ".modal")
          3. I.click(CSS, container) - e.g. I.click("#btn", ".modal")
          4. I.click(CSS) or I.click(XPath) - when locator already includes context (ID, XPath)
          5. I.clickXY(x, y) - coordinates fallback
          IMPORTANT: Always include at least one command WITHOUT a container as fallback,
          in case the element moved to a different section (e.g. I.click("Save") without container).
        `),
        explanation: z.string().describe('Why you are clicking this element'),
      }),
      execute: async ({ commands: rawCommands, explanation }) => {
        const activeNote = task.startNote(explanation);

        if (rawCommands.length === 0) {
          activeNote.commit(TestResult.FAILED);
          return failedToolResult('click', 'No commands provided');
        }

        const invalidCommands = rawCommands.map((cmd) => cmd.trim()).filter((cmd) => cmd.startsWith('I.') && !cmd.startsWith('I.click'));

        if (invalidCommands.length > 0) {
          activeNote.commit(TestResult.FAILED);
          return failedToolResult('click', `Invalid commands: ${invalidCommands.join(', ')}. Click tool only accepts I.click() or I.clickXY() commands.`, {
            suggestion: 'Use form() tool for typing text or multiple actions, or exitIframe() to leave iframe context.',
          });
        }

        const commands = rawCommands.map((cmd) => {
          const trimmed = cmd.trim();
          if (trimmed.startsWith('I.click')) return trimmed;
          return `I.click(${JSON.stringify(trimmed)})`;
        });

        const previousState = ActionResult.fromState(stateManager.getCurrentState()!);
        const action = explorer.createAction();
        const attempts: Array<{ command: string; success: boolean; error?: string }> = [];

        for (let i = 0; i < commands.length; i++) {
          const command = transformContainsCommand(commands[i]);
          const isLast = i === commands.length - 1;
          const success = await action.attempt(command, explanation, isLast);

          attempts.push({
            command,
            success,
            ...(action.lastError && { error: action.lastError.toString() }),
          });

          if (success) {
            const toolResult = await ActionResult.fromState(stateManager.getCurrentState()!).toToolResult(previousState, command);
            if (toolResult?.pageDiff?.ariaChanges || toolResult?.pageDiff?.urlChanged) {
              activeNote.screenshot = await action.saveScreenshot();
            }
            activeNote.commit(TestResult.PASSED);
            return successToolResult('click', { ...toolResult, attempts, code: command });
          }
        }

        const toolResult = await ActionResult.fromState(stateManager.getCurrentState()!).toToolResult(previousState, commands[0]);
        if (toolResult?.pageDiff?.ariaChanges || toolResult?.pageDiff?.urlChanged) {
          activeNote.screenshot = await action.saveScreenshot();
        }
        activeNote.commit(TestResult.FAILED);

        let suggestion = "Try xpathCheck() to find the element's actual position, see() for visual analysis, or visualClick() to click by visual appearance.";
        const lastError = attempts[attempts.length - 1]?.error || '';
        if (lastError.includes('was not found') || lastError.includes('not found by text')) {
          suggestion = 'Element was not found in the DOM. Use xpathCheck() to locate it, context() to refresh snapshot, or visualClick() to click by visual appearance.';
        } else if (lastError.includes('Timeout') || lastError.includes('intercept')) {
          suggestion = 'Element exists but could not be clicked (possibly covered by overlay or not interactable). Try closing overlapping panels first, or use visualClick().';
        }

        return failedToolResult('click', 'All click commands failed', {
          ...toolResult,
          attempts,
          suggestion,
        });
      },
    }),

    pressKey: tool({
      description: dedent`
        Press a keyboard key or key combination. Use this for special keys like Enter, Escape, Tab, Arrow keys, or key combinations with modifiers.

        IMPORTANT: This tool is ONLY for single key presses or key combinations with modifiers.
        For typing text (multiple characters), use form() tool instead.

        Standard keys: Enter, Escape, Esc, Tab, Backspace, Delete, Del, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Home, End, PageUp, PageDown, Space, F1-F12, or any single character.
        Modifiers: Control, Shift, Alt, Meta, CommandOrControl

        Examples:
        - pressKey({ key: 'Enter' }) - press Enter key
        - pressKey({ key: 'a', modifier: 'Control' }) - press Ctrl+A
        - pressKey({ key: 'Delete', modifier: 'Shift' }) - press Shift+Delete
        - pressKey({ key: 'a', modifier: ['Control', 'Shift'] }) - press Ctrl+Shift+A

        If you need to type multiple characters or words, use form() tool instead.
      `,
      inputSchema: z.object({
        key: z.string().describe('The key to press. Can be a single character or standard key name (Enter, Escape, Tab, Delete, ArrowUp, etc.)'),
        modifier: z
          .union([z.string(), z.array(z.string())])
          .optional()
          .describe('Optional modifier key(s): Control, Shift, Alt, Meta, or CommandOrControl. Can be a single modifier or array for multiple modifiers.'),
        explanation: z.string().describe('Reason for pressing this key.'),
      }),
      execute: async ({ key, modifier, explanation }) => {
        const activeNote = task.startNote(explanation);
        try {
          const standardKeys = new Set(['Enter', 'Escape', 'Esc', 'Tab', 'Backspace', 'Delete', 'Del', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Space', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12']);

          const isSingleChar = key.length === 1;
          const normalizedKey = key.toLowerCase();
          const matchingStandardKey = Array.from(standardKeys).find((sk) => sk.toLowerCase() === normalizedKey);
          const isStandardKey = !!matchingStandardKey;
          const keyToUse = matchingStandardKey || key;

          if (!isSingleChar && !isStandardKey) {
            const previousState = ActionResult.fromState(stateManager.getCurrentState()!);
            const action = explorer.createAction();
            const typeCommand = `I.type(${JSON.stringify(key)})`;
            await action.attempt(typeCommand, explanation);
            const toolResult = await ActionResult.fromState(stateManager.getCurrentState()!).toToolResult(previousState, key);

            if (!action.lastError) {
              if (toolResult?.pageDiff?.ariaChanges || toolResult?.pageDiff?.urlChanged) {
                activeNote.screenshot = await action.saveScreenshot();
              }
              activeNote.commit(TestResult.PASSED);
              return successToolResult('pressKey', {
                ...toolResult,
                message: `Automatically used type() for "${key}" (not a standard key press)`,
                code: typeCommand,
                fallback: true,
              });
            }

            const errorMsg = `pressKey fallback to type() failed: ${action.lastError?.toString()}`;
            if (toolResult?.pageDiff?.ariaChanges || toolResult?.pageDiff?.urlChanged) {
              activeNote.screenshot = await action.saveScreenshot();
            }
            activeNote.commit(TestResult.FAILED);
            return failedToolResult('pressKey', errorMsg, {
              ...toolResult,
              code: typeCommand,
              suggestion: 'The key was not recognized as a standard key press and type() fallback failed.',
            });
          }

          const focusFreeKeys = new Set(['Escape', 'Esc', 'Tab', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12']);
          const needsFocus = !focusFreeKeys.has(keyToUse) && !modifier;

          if (needsFocus) {
            const currentAriaState = stateManager.getCurrentState()?.ariaSnapshot;
            const focused = extractFocusedElement(currentAriaState ?? null);
            if (!focused) {
              activeNote.commit(TestResult.FAILED);
              return failedToolResult('pressKey', `No element is focused. Key '${keyToUse}' requires a focused element.`, {
                suggestion: 'Click the target element first, then press the key.',
              });
            }
          }

          const previousState = ActionResult.fromState(stateManager.getCurrentState()!);
          const action = explorer.createAction();

          let pressKeyCommand: string;
          if (modifier) {
            const modifiers = Array.isArray(modifier) ? modifier : [modifier];
            pressKeyCommand = `I.pressKey([${modifiers.map((m) => JSON.stringify(m)).join(', ')}, ${JSON.stringify(keyToUse)}])`;
          } else {
            pressKeyCommand = `I.pressKey(${JSON.stringify(keyToUse)})`;
          }

          await action.attempt(pressKeyCommand, explanation);
          const toolResult = await ActionResult.fromState(stateManager.getCurrentState()!).toToolResult(previousState, key);

          if (!action.lastError) {
            if (toolResult?.pageDiff?.ariaChanges || toolResult?.pageDiff?.urlChanged) {
              activeNote.screenshot = await action.saveScreenshot();
            }
            activeNote.commit(TestResult.PASSED);
            return successToolResult('pressKey', {
              ...toolResult,
              message: `Pressed key: ${key}${modifier ? ` with modifier(s): ${Array.isArray(modifier) ? modifier.join('+') : modifier}` : ''}`,
              code: pressKeyCommand,
            });
          }

          const errorMsg = `pressKey() failed: ${action.lastError?.toString()}`;
          if (toolResult?.pageDiff?.ariaChanges || toolResult?.pageDiff?.urlChanged) {
            activeNote.screenshot = await action.saveScreenshot();
          }
          activeNote.commit(TestResult.FAILED);
          return failedToolResult('pressKey', errorMsg, {
            ...toolResult,
            code: pressKeyCommand,
            suggestion: 'Verify the key name is correct. For typing text, use form() tool instead.',
          });
        } catch (error) {
          activeNote.commit(TestResult.FAILED);
          const errorMessage = error instanceof Error ? error.toString() : 'Unknown error occurred';
          return failedToolResult('pressKey', `PressKey tool failed: ${errorMessage}`);
        }
      },
    }),

    form: tool({
      description: dedent`
        Execute raw CodeceptJS code block with multiple commands.
        USE THIS TOOL for all keyboard interactions: I.fillField, I.type, I.pressKey.

        Follow <actions> from system prompt for available commands.
        Follow <locator_priority> from system prompt for locator selection.

        Use cases:
        - Typing into input fields (I.fillField, I.type)
        - Pressing keyboard keys (I.pressKey)
        - Working with iframes (switch context with I.switchTo)
        - Performing multiple form actions in a single batch
        - Complex interactions requiring sequential commands

        Example - filling a form with context (PREFERRED):
        I.fillField('Username', 'John', '.login-form')
        I.selectOption('Country', 'USA', '.address-section')
        I.attachFile('input[type="file"]', '/path/file', '.upload-section')

        Example - filling a form with ARIA locators:
        I.fillField({"role":"textbox","text":"Title"}, 'My Article')
        I.selectOption({"role":"combobox","text":"Category"}, 'Technology')

        Example - typing into Monaco editor or rich text:
        I.click({"role":"textbox","text":"Description"})
        I.type('This is the description text')

        Example - pressing keys:
        I.pressKey('Enter')
        I.pressKey(['Control', 'a'])

        Example - attaching a file:
        I.attachFile('input[type="file"]', '/absolute/path/to/sample.png')

        Example - working with iframe:
        I.switchTo('#payment-iframe')
        I.fillField({"role":"textbox","text":"Card"}, '4242424242424242')
        I.fillField({"role":"textbox","text":"CVV"}, '123')
        I.switchTo()

        Do not submit form - use verify() first to check fields were filled correctly, then click() to submit.
        Do not use: wait functions, amOnPage, reloadPage, saveScreenshot
      `,
      inputSchema: z.object({
        codeBlock: z.string().describe('Valid CodeceptJS code starting with I. Can contain multiple commands separated by newlines.'),
        explanation: z.string().describe('Reason for executing this code sequence.'),
      }),
      execute: async ({ codeBlock, explanation }) => {
        const activeNote = task.startNote(explanation);
        try {
          if (!codeBlock.trim()) {
            activeNote.commit(TestResult.FAILED);
            return failedToolResult('form', 'CodeBlock cannot be empty');
          }

          const lines = codeBlock
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line);
          const codeLines = lines.filter((line) => !line.startsWith('//'));

          if (!codeLines.every((line) => line.startsWith('I.'))) {
            activeNote.commit(TestResult.FAILED);
            return failedToolResult('form', 'All non-comment lines must start with I.', {
              suggestion: 'Try again but pass valid CodeceptJS code where every non-comment line starts with I.',
            });
          }

          const previousState = ActionResult.fromState(stateManager.getCurrentState()!);
          const formLocator = codeLines[0] || 'form';
          const action = explorer.createAction();
          await action.attempt(codeBlock, explanation);

          const toolResult = await ActionResult.fromState(stateManager.getCurrentState()!).toToolResult(previousState, formLocator);

          if (action.lastError) {
            const message = action.lastError ? String(action.lastError) : 'Unknown error';
            if (toolResult?.pageDiff?.ariaChanges || toolResult?.pageDiff?.urlChanged) {
              activeNote.screenshot = await action.saveScreenshot();
            }
            activeNote.commit(TestResult.FAILED);
            return failedToolResult('form', `Form execution FAILED! ${message}`, {
              ...toolResult,
              code: codeBlock,
              suggestion: 'Look into error message and identify which commands passed and which failed. Continue execution using step-by-step approach using click() and form() tools.',
            });
          }

          if (toolResult?.pageDiff?.ariaChanges || toolResult?.pageDiff?.urlChanged) {
            activeNote.screenshot = await action.saveScreenshot();
          }
          activeNote.commit(TestResult.PASSED);
          return successToolResult('form', {
            ...toolResult,
            message: `Form completed successfully with ${lines.length} commands.`,
            commandsExecuted: lines.length,
            code: codeBlock,
            suggestion: 'Verify the form was filled in correctly using see() tool. Submit if needed by using click() tool.',
          });
        } catch (error) {
          activeNote.commit(TestResult.FAILED);
          const errorMessage = error instanceof Error ? error.toString() : 'Unknown error occurred';
          return failedToolResult('form', `Form tool failed: ${errorMessage}`);
        }
      },
    }),
  };
}

export function createSpecialContextTools(explorer: Explorer, context: 'iframe') {
  const stateManager = explorer.getStateManager();

  if (context !== 'iframe') {
    return {};
  }

  return {
    exitIframe: tool({
      description: dedent`
        Exit the current iframe and return to the main page context.

        Use this only when you are already working inside an iframe and need to interact
        with elements outside that iframe.
      `,
      inputSchema: z.object({
        reason: z.string().optional().describe('Why you need to leave the iframe context.'),
      }),
      execute: async ({ reason }) => {
        try {
          const previousState = ActionResult.fromState(stateManager.getCurrentState()!);

          if (!previousState.isInsideIframe) {
            return failedToolResult('exitIframe', 'You are not inside an iframe.', {
              suggestion: 'Continue interacting with the current page context.',
            });
          }

          await explorer.switchToMainFrame();

          const action = explorer.createAction();
          const nextState = await action.capturePageState();
          const toolResult = await nextState.toToolResult(previousState, 'I.switchTo()');

          return successToolResult('exitIframe', {
            ...toolResult,
            message: reason || 'Exited iframe and returned to the main page context.',
            code: 'I.switchTo()',
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.toString() : 'Unknown error occurred';
          return failedToolResult('exitIframe', `Failed to exit iframe: ${errorMessage}`);
        }
      },
    }),
  };
}

export function createAgentTools({
  explorer,
  researcher,
  navigator,
}: {
  explorer: Explorer;
  researcher: Researcher;
  navigator: Navigator;
}): any {
  let visionDisabled = false;

  return {
    see: tool({
      description: dedent`
        Check the page contents based on current page state and screenshot.
        This tool will trigger visual research to check the page contents on request.
        Use it to verify the actions were performed correctly and the page is in the expected state.

        <example>
        request: "Check current state of the Login form"
        result: "Login form is visible with username and password fields, username is filled with 'testuser' and password is empty' 
        </example>
      `,
      inputSchema: z.object({
        request: z.string().describe('LLM-friendly description of the page contents to look for. 1-3 sentences. No more than 100 words.'),
      }),
      execute: async ({ request }) => {
        if (visionDisabled) {
          return failedToolResult('see', 'Vision tools are disabled for this session. Use context() to get fresh ARIA snapshot and analyze page state from ARIA data.');
        }

        try {
          const action = explorer.createAction();
          const actionResult = await action.caputrePageWithScreenshot();

          if (!actionResult.screenshot) {
            return failedToolResult('see', 'Failed to capture screenshot for analysis');
          }

          const analysisResult = await researcher.answerQuestionAboutScreenshot(actionResult, request);

          if (!analysisResult) {
            return failedToolResult('see', 'AI analysis failed to process the screenshot');
          }

          return successToolResult('see', {
            analysis: analysisResult,
            message: `Successfully analyzed screenshot for: ${request}`,
            suggestion: 'Visual confirmation is valid evidence for test results. Use record() to note the visual findings.',
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.toString() : 'Unknown error occurred';
          visionDisabled = true;
          tag('warning').log(`⚠️ Vision model is not available. Visual checks are disabled for this session.`);
          return failedToolResult('see', `See tool failed: ${errorMessage}`, {
            suggestion: 'Vision is now disabled. Use context() to get fresh ARIA snapshot and analyze page state from ARIA data.',
          });
        }
      },
    }),

    context: tool({
      description: dedent`
        Get current page HTML and ARIA snapshot.
        
        DO NOT call this if:
        - You just performed an action (pageDiff already provided in response)
        - You already have recent <page_html>/<page_aria> in context
        - You're about to perform an action (you'll get pageDiff after)
        
        Call ONLY when:
        - Context is stale (many conversation turns since last state update)
        - You suspect page changed externally (timers, auto-refresh)
        - You need fresh state before planning next actions
      `,
      inputSchema: z.object({
        reason: z.string().describe('Why do you need fresh context? Required to prevent overuse.'),
      }),
      execute: async ({ reason }) => {
        try {
          const stateManager = explorer.getStateManager();
          const currentState = stateManager.getCurrentState();

          if (!currentState) {
            return failedToolResult('context', 'No current page state available.');
          }

          const actionResult = ActionResult.fromState(currentState);
          const html = await actionResult.simplifiedHtml();
          const aria = currentState.ariaSnapshot || '';

          return successToolResult('context', {
            url: currentState.url,
            title: currentState.title,
            suggestion: 'If not enough context received, call see() to visually identify elements in page contents',
            aria,
            html,
            reminder: 'Context provided. Do not call context() again until you perform actions or suspect page changed.',
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.toString() : 'Unknown error occurred';
          return failedToolResult('context', `Context tool failed: ${errorMessage}`);
        }
      },
    }),

    verify: tool({
      description: dedent`
        Verify an assertion about the current page state using AI-powered verification.
        This tool uses the Navigator's verifyState method to check if the page matches the expected condition.
        Be precise and explicit in your assertion request to avoid false positives.
        Ask the question including the context and if possible the current user flow.
        Identify which page area you are referring to and which must be asserted.
        If possible provide context locator to narrow down the search area.
        The AI will attempt multiple verification strategies using CodeceptJS assertions.
      `,
      inputSchema: z.object({
        assertion: z.string().describe('The assertion or condition to verify on the current page (e.g., "User is logged in", "Form validation error is displayed in the footer")'),
      }),
      execute: async ({ assertion }) => {
        try {
          const currentState = explorer.getStateManager().getCurrentState();
          const verifications = currentState?.verifications;

          if (verifications?.[assertion] !== undefined) {
            return failedToolResult('verify', `Already verified: "${assertion}" → ${verifications[assertion] ? 'PASS' : 'FAIL'}`, {
              alreadyVerified: true,
              verifications,
              suggestion: verifications[assertion] ? 'This verification already passed. Call finish() to complete the test.' : 'This verification already failed. Perform actions to change the page state, then try again.',
            });
          }

          const action = explorer.createAction();
          const actionResult = await action.capturePageState();
          const result = await navigator.verifyState(assertion, actionResult);

          if (result.verified) {
            return successToolResult('verify', {
              message: `Verification passed: ${assertion}`,
              code: result.successfulCodes.join('\n'),
            });
          }

          return failedToolResult('verify', `Verification failed: ${assertion}`, {
            suggestion: 'The assertion could not be verified. Check if the condition is actually present on the page or try a different assertion.',
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.toString() : 'Unknown error occurred';
          return failedToolResult('verify', `Verify tool failed: ${errorMessage}`, {
            error: errorMessage,
          });
        }
      },
    }),

    research: tool({
      description: dedent`
        Research the current page to understand its structure, UI elements, and navigation.
        This tool provides UI map report including forms, buttons, menus, and other interactive elements.
        
        DO NOT call this if:
        - You already have <page_ui_map> or <initial_page_ui_map> in context
        - You just navigated to a page (research is provided automatically)
        - You're on the same page you already researched
        - pageDiff was small (minor changes don't need full research)
        
        Call ONLY when:
        - Page structure is unclear and no UI map was provided
        - You need to discover hidden/collapsed elements not in current context
        - Page has dramatically changed after previous action
        
        Avoid calling this tool twice in a row.
      `,
      inputSchema: z.object({
        reason: z.string().describe('Why do you need research? What information is missing from existing context?'),
      }),
      execute: async ({ reason }) => {
        try {
          const stateManager = explorer.getStateManager();
          const currentState = stateManager.getCurrentState();

          if (!currentState) {
            return failedToolResult('research', 'No current page state available. Navigate to a page first.');
          }

          const researchResult = await researcher.research(currentState, { screenshot: true, data: true });

          return successToolResult('research', {
            analysis: researchResult,
            aria: await ActionResult.fromState(currentState).ariaSnapshot,
            message: `Successfully researched page: ${currentState.url}.`,
            suggestion: dedent`
              You received comprehensive UI map report. Use it to understand the page structure and navigate to the elements. 
              Do not ask for research() if you have <page_ui_map> for current page.
              Follow <section_context_rule> when selecting locators for all tools.

              If sections are listed in report use section container locators when picking elements from inside sections:

              ${sectionContextRule}
            `,
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.toString() : 'Unknown error occurred';
          return failedToolResult('research', `Research tool failed: ${errorMessage}`, {
            error: errorMessage,
          });
        }
      },
    }),

    interact: tool({
      description: dedent`
        Execute an action on the current page using AI-powered interaction.
        Use this to perform actions like clicking buttons, selecting options, filling forms, etc.
        The AI will generate and try multiple CodeceptJS code strategies to accomplish the instruction.
      `,
      inputSchema: z.object({
        instruction: z.string().describe('What action to perform on the page, e.g. "select new suite option", "click the Submit button"'),
      }),
      execute: async ({ instruction }) => {
        try {
          const stateManager = explorer.getStateManager();
          const currentState = stateManager.getCurrentState();

          if (!currentState) {
            return failedToolResult('interact', 'No current page state available. Navigate to a page first.');
          }

          const previousState = ActionResult.fromState(currentState);
          const actionResult = ActionResult.fromState(currentState);
          const success = await navigator.resolveState(instruction, actionResult);

          const toolResult = await ActionResult.fromState(stateManager.getCurrentState()!).toToolResult(previousState, instruction);

          if (success) {
            return successToolResult('interact', {
              ...toolResult,
              message: `Successfully executed: ${instruction}`,
            });
          }

          return failedToolResult('interact', `Failed to execute: ${instruction}`, {
            ...toolResult,
            suggestion: 'The action could not be completed. Try a different instruction or use more specific element descriptions.',
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.toString() : 'Unknown error occurred';
          return failedToolResult('interact', `Interact tool failed: ${errorMessage}`, {
            error: errorMessage,
          });
        }
      },
    }),

    visualClick: tool({
      description: dedent`
        Click an element by visual identification when locator-based click() fails.

        Use this as fallback when:
        - click() failed with all provided commands
        - Element is visually present but not accessible via locators
        - Custom/canvas elements that don't have proper DOM structure

        This tool analyzes screenshot to locate element and clicks at its coordinates.
      `,
      inputSchema: z.object({
        element: z.string().describe('Visual description of element to click (e.g., "blue Submit button in the modal footer", "Settings gear icon in top right")'),
        context: z.string().describe('What you already tried and why it failed - helps with accurate identification'),
      }),
      execute: async ({ element, context }) => {
        if (visionDisabled) {
          return failedToolResult('visualClick', 'Vision tools are disabled for this session. Use xpathCheck() to find the element, then click() with the discovered locator.');
        }

        try {
          const stateManager = explorer.getStateManager();
          const currentState = stateManager.getCurrentState();

          if (!currentState) {
            return failedToolResult('visualClick', 'No current page state available.');
          }

          const previousState = ActionResult.fromState(currentState);
          const action = explorer.createAction();
          const actionResult = await action.caputrePageWithScreenshot();

          if (!actionResult.screenshot) {
            return failedToolResult('visualClick', 'Failed to capture screenshot for visual analysis');
          }

          const locationResult = await researcher.checkElementLocation(actionResult, element);

          if (!locationResult) {
            return failedToolResult('visualClick', 'Visual analysis failed to process the screenshot');
          }

          const coordMatch = locationResult.match(/(\d+)X,\s*(\d+)Y/i);

          if (!coordMatch) {
            return failedToolResult('visualClick', `Element not found: ${locationResult}`, {
              analysis: locationResult,
              suggestion: 'Element may not be visible on screen. Try scrolling or check if element exists.',
            });
          }

          const x = Number.parseInt(coordMatch[1], 10);
          const y = Number.parseInt(coordMatch[2], 10);

          const clickSuccess = await action.attempt(`I.clickXY(${x}, ${y})`, `Visual click: ${element}`);
          const toolResult = await ActionResult.fromState(stateManager.getCurrentState()!).toToolResult(previousState, element);

          if (clickSuccess) {
            return successToolResult('visualClick', {
              ...toolResult,
              message: `Clicked "${element}" at coordinates (${x}, ${y})`,
              analysis: locationResult,
            });
          }

          return failedToolResult('visualClick', 'Click at coordinates failed', {
            ...toolResult,
            coordinates: { x, y },
            analysis: locationResult,
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.toString() : 'Unknown error occurred';
          visionDisabled = true;
          tag('warning').log(`⚠️ Vision model is not available. Visual clicks are disabled for this session.`);
          return failedToolResult('visualClick', `visualClick tool failed: ${errorMessage}`, {
            suggestion: 'Vision is now disabled. Use xpathCheck() to find the element, then click() with the discovered locator.',
          });
        }
      },
    }),

    askUser: tool({
      description: dedent`
        Ask the user for help when you're stuck or unsure how to proceed.
        Only available in interactive mode (TUI).

        Use when:
        - Locator-based clicks keep failing
        - You can't find an element that should exist
        - Form interaction isn't working as expected
        - You need clarification on what action to take
      `,
      inputSchema: z.object({
        question: z.string().describe('What you need help with - be specific about what failed'),
        context: z.string().optional().describe('Relevant context like locators tried, errors received'),
      }),
      execute: async ({ question, context }) => {
        if (!isInteractive()) {
          return {
            success: false,
            message: 'User input not available in non-interactive mode',
            suggestion: 'Continue with automated recovery',
          };
        }

        const prompt = context ? `${question}\n\nContext: ${context}\n\nYour suggestion ("skip" to continue):` : `${question}\n\nYour suggestion ("skip" to continue):`;

        const userInput = await pause(prompt);

        if (!userInput || userInput.toLowerCase() === 'skip') {
          return { success: false, message: 'User skipped' };
        }

        return {
          success: true,
          userSuggestion: userInput,
          instruction: 'Follow the user suggestion. Use interact() tool to execute.',
        };
      },
    }),

    back: tool({
      description: dedent`
        Navigate back to the previous page (most recent URL different from current).
        Use when you accidentally navigated to a wrong page and want to return one step.
        For going all the way back to the starting page, use reset() instead.
      `,
      inputSchema: z.object({
        reason: z.string().describe('Why you need to go back'),
      }),
      execute: async ({ reason }) => {
        const stateManager = explorer.getStateManager();
        const currentUrl = stateManager.getCurrentState()?.url;
        const history = stateManager.getStateHistory();

        let targetUrl: string | null = null;
        for (let i = history.length - 1; i >= 0; i--) {
          const url = history[i].toState.url;
          if (url !== currentUrl) {
            targetUrl = url;
            break;
          }
        }

        if (!targetUrl) {
          return failedToolResult('back', 'No previous page found in history.', {
            suggestion: 'Use reset() to navigate to the starting page.',
          });
        }

        const action = explorer.createAction();
        const success = await action.attempt(`I.amOnPage(${JSON.stringify(targetUrl)})`, `${reason} (BACK to ${targetUrl})`);

        if (success) {
          const previousState = ActionResult.fromState(stateManager.getCurrentState()!);
          const toolResult = await previousState.toToolResult(previousState, `I.amOnPage("${targetUrl}")`);
          return successToolResult('back', {
            ...toolResult,
            message: `Navigated back to ${targetUrl}`,
          });
        }

        return failedToolResult('back', `Failed to navigate back to ${targetUrl}`, {
          suggestion: 'Try reset() to return to the starting page.',
          ...(action.lastError && { error: action.lastError.toString() }),
        });
      },
    }),

    getVisitedStates: tool({
      description: 'List all previously visited page states (deduped by URL). Use to find pages to navigate back to.',
      inputSchema: z.object({}),
      execute: async () => {
        const history = explorer.getStateManager().getStateHistory();
        const seen = new Set<string>();
        const states = history
          .map((t) => t.toState)
          .filter((s) => {
            if (seen.has(s.url)) return false;
            seen.add(s.url);
            return true;
          })
          .map((s, i) => ({ index: i, url: s.url, title: s.title, h1: s.h1 }));
        return { success: true, states };
      },
    }),

    xpathCheck: tool({
      description: dedent`
        It seems the desired element could not be reached by Tester.
        Full HTML context is too large to provide, but you can propose XPath locators to search for the needed element.

        Think carefully about the XPath — if it's too narrow you may miss the element.
        Use broad enough locators combining: ids, classes, aria-* attributes, semantic elements, data attributes, text content.

        Start broad (e.g. //button, //*[contains(text(), 'Save')]) then narrow down.
        Multiple calls are encouraged — refine until you find a unique match.

        After finding matches, visibility is automatically verified in the live browser.
        If element exists in DOM but is not visible, consider what action could reveal it (scroll, click to expand, wait).
      `,
      inputSchema: z.object({
        xpath: z.string().describe('XPath expression — use broad patterns to avoid missing the element'),
        reason: z.string().describe('What element you are looking for and why'),
      }),
      execute: async ({ xpath, reason }) => {
        const stateManager = explorer.getStateManager();
        const currentState = stateManager.getCurrentState();

        if (!currentState) {
          return failedToolResult('xpathCheck', 'No current page state available.');
        }

        const html = ActionResult.fromState(currentState).html;
        if (!html) {
          return failedToolResult('xpathCheck', 'No HTML available for current page state.');
        }

        const result = await WebElement.findByXPath(html, xpath);

        if (result.error) {
          return failedToolResult('xpathCheck', `XPath error: ${result.error}`, {
            suggestion: 'Check XPath syntax. Common issues: unescaped quotes, missing brackets, invalid axis names.',
          });
        }

        if (result.totalFound === 0) {
          return failedToolResult('xpathCheck', `No elements matched XPath: ${xpath}`, {
            suggestion: 'Try a broader expression. Examples: //*[contains(@class, "btn")], //button, //*[contains(text(), "keyword")]',
          });
        }

        const action = explorer.createAction();
        const visible = await action.attempt(`I.seeElement(${JSON.stringify(xpath)})`, 'xpathCheck visibility', false);

        const matchesSummary = result.elements.map((el, i) => `${i + 1}. <${el.tag} ${el.keyAttrs}> text="${el.text}" html: ${el.outerHTML}`).join('\n');

        const visibilityNote = visible ? 'Element IS visible in browser — Tester can use this XPath as locator.' : 'Element exists in DOM but is NOT visible. May need scrolling, a click to reveal, or is hidden.';

        return successToolResult('xpathCheck', {
          totalFound: result.totalFound,
          matches: matchesSummary,
          visibilityNote,
          xpath,
        });
      },
    }),
  };
}

const PAGE_DIFF_SUGGESTION = 'Analyze page diff. htmlParts shows what changed and WHERE — each part has a container selector. Use the container as context when clicking elements from the diff.';

function transformContainsCommand(command: string): string {
  if (!command.includes(':contains(')) return command;

  const containsMatch = command.match(/:contains\(["']([^"']+)["']\)/);
  if (!containsMatch) return command;

  const text = containsMatch[1];
  const cleaned = command.replace(containsMatch[0], '');

  const twoArgMatch = cleaned.match(/I\.click\(\s*(['"`])(.+?)\1\s*,\s*(['"`])(.+?)\3\s*\)/);
  if (twoArgMatch) {
    const baseSelector = twoArgMatch[2].trim();
    const context = twoArgMatch[4].trim();
    return `I.click(${JSON.stringify(text)}, ${JSON.stringify(`${context} ${baseSelector}`)})`;
  }

  const oneArgMatch = cleaned.match(/I\.click\(\s*(['"`])(.+?)\1\s*\)/);
  if (oneArgMatch) {
    const baseSelector = oneArgMatch[2].trim();
    return `I.click(${JSON.stringify(text)}, ${JSON.stringify(baseSelector)})`;
  }

  return command;
}

function successToolResult(action: string, data?: Record<string, any>) {
  const result: Record<string, any> = { success: true, action, ...data };
  if (data?.pageDiff) {
    result.suggestion = data.suggestion ? `${data.suggestion} ${PAGE_DIFF_SUGGESTION}` : PAGE_DIFF_SUGGESTION;
  }
  return result;
}

async function failedToolResult(action: string, message: string, data?: Record<string, any>, error?: Error | null) {
  const result: Record<string, any> = { success: false, action, message, ...data };
  if (data?.pageDiff) {
    result.suggestion = data.suggestion ? `${data.suggestion} ${PAGE_DIFF_SUGGESTION}` : PAGE_DIFF_SUGGESTION;
  }

  const multipleElementsSuggestion = getMultipleElementsSuggestion(message);
  if (multipleElementsSuggestion) {
    result.suggestion = multipleElementsSuggestion;
    result.multipleElementsDetected = true;
    result.elements = await formatMatchedElements(error);
    return result;
  }

  const notFoundSuggestion = getNotFoundSuggestion(message);
  if (notFoundSuggestion) {
    result.suggestion = notFoundSuggestion;
    result.elementNotFound = true;
  }

  return result;
}

function getMultipleElementsSuggestion(errorMessage: string): string | null {
  if (!errorMessage.includes('Multiple elements') && !errorMessage.includes('multiple elements')) {
    return null;
  }

  return dedent`
    Multiple elements matched your locator. To fix this:
    1. Use container context: I.click({ "role": "button", "text": "Submit" }, '.form-container')
    2. Use more specific CSS: target the actual element (input, button, a) not wrapper divs
    3. Add distinguishing attributes: input[type="submit"], button[type="submit"], [value="..."]
    4. If buttons have similar text like "Create" and "Create Demo", use the FULL unique text
    5. Use xpathCheck() to inspect matched elements and pick the correct one
    6. Use visualClick() to click the right element by visual appearance
  `;
}

async function formatMatchedElements(error: Error | null | undefined): Promise<string | null> {
  if (!error || error.name !== 'MultipleElementsFound') return null;

  const elements = (error as any).webElements as Array<{ toAbsoluteXPath: () => Promise<string>; toSimplifiedHTML: () => Promise<string> }> | undefined;
  if (!elements?.length) return null;

  let allUnknown = true;
  const lines: string[] = [];

  for (let i = 0; i < Math.min(elements.length, 10); i++) {
    let xpath = '<unknown>';
    let html = '<unknown>';
    try {
      xpath = await elements[i].toAbsoluteXPath();
      allUnknown = false;
    } catch (e) {
      debugLog('Failed to get XPath for matched element %d: %s', i, e);
    }
    try {
      html = await elements[i].toSimplifiedHTML();
      allUnknown = false;
    } catch (e) {
      debugLog('Failed to get HTML for matched element %d: %s', i, e);
    }
    lines.push(`Element ${i + 1}\nXPath: ${xpath}\nHTML: ${html}`);
  }

  if (allUnknown) return 'Could not fetch element details. Repeat the action to get better info.';

  return lines.join('\n\n');
}

function getNotFoundSuggestion(errorMessage: string): string | null {
  if (!errorMessage.includes('was not found') && !errorMessage.includes('not found by text|CSS|XPath')) {
    return null;
  }

  return dedent`
    Element was not found. The locator does not exist on this page.
    1. Use see() to visually analyze what elements are actually on the page
    2. Use context() to get fresh HTML and ARIA snapshot
    3. Use ONLY locators from <page_aria> or <page_html>
    4. Prefer ARIA locators: { "role": "button", "text": "visible text" }
  `;
}
