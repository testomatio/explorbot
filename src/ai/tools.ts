import { tool } from 'ai';
import dedent from 'dedent';
import { z } from 'zod';
import { ActionResult, type ToolResultMetadata } from '../action-result.ts';
import type Explorer from '../explorer.ts';
import { TestResult, type Task } from '../test-plan.js';
import { pause } from '../utils/loop.js';
import { createDebug } from '../utils/logger.js';
import { Navigator } from './navigator.ts';
import { Researcher } from './researcher.ts';
import { sectionContextRule, sectionUiMapRule } from './rules.ts';
import { isInteractive } from './task-agent.ts';

const debugLog = createDebug('explorbot:tools');

export const CODECEPT_TOOLS = ['click', 'type', 'select', 'pressKey', 'form'] as const;

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

        IMPORTANT: This tool ONLY accepts click commands. For typing text, use type() tool separately.
        For multiple actions (type + click), use form() tool or call type() and click() separately.
      `,
      inputSchema: z.object({
        commands: z.array(z.string()).describe(dedent`
          Order by reliability:
          1. I.click(ARIA, container) - e.g. I.click({"role":"button","text":"Save"}, ".modal")
          2. I.click(text, container) - e.g. I.click("Save", ".modal")
          3. I.click(ARIA) - e.g. I.click({"role":"button","text":"Save"})
          4. I.click(CSS) or I.click(XPath) - e.g. I.click("#btn"), I.click("//button")
          5. I.clickXY(x, y) - coordinates fallback
        `),
        explanation: z.string().describe('Why you are clicking this element'),
      }),
      execute: async ({ commands, explanation }) => {
        const activeNote = task.startNote(explanation);

        if (commands.length === 0) {
          activeNote.commit(TestResult.FAILED);
          return failedToolResult('click', 'No commands provided');
        }

        const invalidCommands = commands.filter((cmd) => !cmd.trim().startsWith('I.click'));

        if (invalidCommands.length > 0) {
          activeNote.commit(TestResult.FAILED);
          return failedToolResult('click', `Invalid commands: ${invalidCommands.join(', ')}. Click tool only accepts I.click() or I.clickXY() commands.`, {
            suggestion: 'Use type() tool for typing text, or form() tool for multiple actions (type + click).',
          });
        }

        const previousState = ActionResult.fromState(stateManager.getCurrentState()!);
        const action = explorer.createAction();
        const attempts: Array<{ command: string; success: boolean; error?: string }> = [];

        for (let i = 0; i < commands.length; i++) {
          const command = commands[i];
          const isLast = i === commands.length - 1;
          const success = await action.attempt(command, explanation, isLast);

          attempts.push({
            command,
            success,
            ...(action.lastError && { error: action.lastError.toString() }),
          });

          if (success) {
            const toolResult = await ActionResult.fromState(stateManager.getCurrentState()!).toToolResult(previousState, command);
            activeNote.commit(TestResult.PASSED);
            return successToolResult('click', { ...toolResult, attempts, code: command });
          }
        }

        const toolResult = await ActionResult.fromState(stateManager.getCurrentState()!).toToolResult(previousState, commands[0]);
        activeNote.commit(TestResult.FAILED);
        return failedToolResult('click', 'All click commands failed', {
          ...toolResult,
          attempts,
          suggestion: 'Use see() to verify element exists, or visualClick() for visual fallback.',
        });
      },
    }),

    type: tool({
      description: dedent`
        Send keyboard input to a field. After typing, the page state will be automatically captured and returned.
        Omit locator if input is already focused.

        Prefer ARIA locators: {"role":"textbox","text":"Email"}
        Fall back to CSS/XPath if ARIA fails.

        IMPORTANT: This tool is ONLY for typing text. To click buttons after typing, call click() tool separately.
        For multiple actions (type + click), use form() tool or call type() and click() separately.
      `,
      inputSchema: z.object({
        text: z.string().describe('The text to type'),
        locator: z.string().optional().describe('ARIA locator (starts with { role: ) or CSS/XPath. Omit to type into focused element.'),
        explanation: z.string().describe('Reason for providing this input.'),
      }),
      execute: async ({ text, locator, explanation }) => {
        const activeNote = task.startNote(explanation);
        try {
          const previousState = ActionResult.fromState(stateManager.getCurrentState()!);
          const targetLocator = locator || 'focused';
          const action = explorer.createAction();

          if (!locator) {
            const typeCommand = `I.type(${JSON.stringify(text)})`;
            await action.attempt(typeCommand, explanation);
            const toolResult = await ActionResult.fromState(stateManager.getCurrentState()!).toToolResult(previousState, targetLocator);

            if (!action.lastError) {
              activeNote.commit(TestResult.PASSED);
              return successToolResult('type', {
                ...toolResult,
                message: `Typed "${text}" into focused element`,
                code: typeCommand,
              });
            }

            const errorMsg = `type() failed: ${action.lastError?.toString()}`;
            activeNote.commit(TestResult.FAILED);
            return failedToolResult('type', errorMsg, {
              ...toolResult,
              code: typeCommand,
              suggestion: 'Provide a locator for the input field. Use see() to identify the correct element to fill in.',
            });
          }

          const fillCommand = `I.fillField(${formatLocator(locator)}, ${JSON.stringify(text)})`;
          await action.attempt(fillCommand, explanation);

          if (!action.lastError) {
            const toolResult = await ActionResult.fromState(stateManager.getCurrentState()!).toToolResult(previousState, targetLocator);
            activeNote.commit(TestResult.PASSED);
            return successToolResult('type', {
              ...toolResult,
              message: `Input field ${locator} was filled with value ${text}`,
              code: fillCommand,
            });
          }

          await action.attempt(`I.click(${formatLocator(locator)})`, explanation);

          const fallbackCommand = `I.pressKey(['CommandOrControl', 'a']); I.pressKey('Delete'); I.type(${JSON.stringify(text)})`;
          await action.attempt(fallbackCommand, explanation);

          const toolResult = await ActionResult.fromState(stateManager.getCurrentState()!).toToolResult(previousState, targetLocator);

          if (!action.lastError) {
            activeNote.commit(TestResult.PASSED);
            return successToolResult('type', {
              ...toolResult,
              message: 'type() worked by clicking element and typing in values',
              code: fallbackCommand,
            });
          }

          const errorMsg = `type() failed: ${action.lastError?.toString()}`;
          activeNote.commit(TestResult.FAILED);
          return failedToolResult('type', errorMsg, {
            ...toolResult,
            code: fillCommand,
            suggestion: 'Try a different locator or use clickXY to focus the field first, then call type() without locator.',
          });
        } catch (error) {
          activeNote.commit(TestResult.FAILED);
          const errorMessage = error instanceof Error ? error.toString() : 'Unknown error occurred';
          return failedToolResult('type', `Type tool failed: ${errorMessage}`);
        }
      },
    }),

    select: tool({
      description: dedent`
        Select an option from a dropdown, listbox, combobox, or select element.

        I.selectOption(<locator>, <value>)

        Works with: <select>, listbox, combobox, dropdown buttons, and custom select components.
        Value can be option text, value attribute, or label.

        Prefer ARIA locators: {"role":"combobox","text":"Select country"}
        Fall back to CSS/XPath if ARIA fails.

        <example>
          I.selectOption({ role: 'combobox', text: 'Select country' }, 'USA');
          I.selectOption('Country', 'United States');
          I.selectOption('#country-select', 'US');
        </example>
      `,
      inputSchema: z.object({
        locator: z.string().describe('ARIA locator (starts with { role: ), label text, or CSS/XPath locator.'),
        option: z.string().describe('The option to select - can be visible text, value attribute, or label'),
        explanation: z.string().describe('Reason for selecting this option.'),
      }),
      execute: async ({ locator, option, explanation }) => {
        const activeNote = task.startNote(explanation);
        try {
          debugLog('Select locator:', locator, 'option:', option);

          const previousState = ActionResult.fromState(stateManager.getCurrentState()!);
          const action = explorer.createAction();
          const selectCommand = `I.selectOption(${formatLocator(locator)}, ${JSON.stringify(option)})`;
          const selectSuccess = await action.attempt(selectCommand, explanation);

          const toolResult = await ActionResult.fromState(stateManager.getCurrentState()!).toToolResult(previousState, locator);

          if (selectSuccess) {
            activeNote.commit(TestResult.PASSED);
            return successToolResult('select', {
              ...toolResult,
              message: `Option "${option}" was selected in ${locator}`,
              code: selectCommand,
            });
          }

          const page = !toolResult?.pageDiff && ActionResult.fromState(stateManager.getCurrentState()!).toAiContext();
          const errorMsg = action.lastError?.toString() || 'Select option did not succeed';

          activeNote.commit(TestResult.FAILED);
          return failedToolResult('select', errorMsg, {
            ...toolResult,
            page,
            code: selectCommand,
            suggestion: 'Verify the locator points to a select/combobox element. For custom dropdowns, try click() to open it first, then click() to select the option.',
          });
        } catch (error) {
          activeNote.commit(TestResult.FAILED);
          const errorMessage = error instanceof Error ? error.toString() : 'Unknown error occurred';
          return failedToolResult('select', `Select tool failed: ${errorMessage}`);
        }
      },
    }),

    pressKey: tool({
      description: dedent`
        Press a keyboard key or key combination. Use this for special keys like Enter, Escape, Tab, Arrow keys, or key combinations with modifiers.

        IMPORTANT: This tool is ONLY for single key presses or key combinations with modifiers.
        For typing text (multiple characters), use type() tool instead.

        Standard keys: Enter, Escape, Esc, Tab, Backspace, Delete, Del, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Home, End, PageUp, PageDown, Space, F1-F12, or any single character.
        Modifiers: Control, Shift, Alt, Meta, CommandOrControl

        Examples:
        - pressKey({ key: 'Enter' }) - press Enter key
        - pressKey({ key: 'a', modifier: 'Control' }) - press Ctrl+A
        - pressKey({ key: 'Delete', modifier: 'Shift' }) - press Shift+Delete
        - pressKey({ key: 'a', modifier: ['Control', 'Shift'] }) - press Ctrl+Shift+A

        If you need to type multiple characters or words, use type() tool instead.
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
              activeNote.commit(TestResult.PASSED);
              return successToolResult('pressKey', {
                ...toolResult,
                message: `Automatically used type() for "${key}" (not a standard key press)`,
                code: typeCommand,
                fallback: true,
              });
            }

            const errorMsg = `pressKey fallback to type() failed: ${action.lastError?.toString()}`;
            activeNote.commit(TestResult.FAILED);
            return failedToolResult('pressKey', errorMsg, {
              ...toolResult,
              code: typeCommand,
              suggestion: 'The key was not recognized as a standard key press and type() fallback failed.',
            });
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
            activeNote.commit(TestResult.PASSED);
            return successToolResult('pressKey', {
              ...toolResult,
              message: `Pressed key: ${key}${modifier ? ` with modifier(s): ${Array.isArray(modifier) ? modifier.join('+') : modifier}` : ''}`,
              code: pressKeyCommand,
            });
          }

          const errorMsg = `pressKey() failed: ${action.lastError?.toString()}`;
          activeNote.commit(TestResult.FAILED);
          return failedToolResult('pressKey', errorMsg, {
            ...toolResult,
            code: pressKeyCommand,
            suggestion: 'Verify the key name is correct. For typing text, use type() tool instead.',
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

        Follow <actions> from system prompt for available commands.
        Follow <locator_priority> from system prompt for locator selection.

        Use cases:
        - Working with iframes (switch context with I.switchTo)
        - Performing multiple form actions in a single batch
        - Complex interactions requiring sequential commands

        Example - filling a form:
        I.fillField({"role":"textbox","text":"Title"}, 'My Article')
        I.selectOption({"role":"combobox","text":"Category"}, 'Technology')

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
            activeNote.commit(TestResult.FAILED);
            return failedToolResult('form', `Form execution FAILED! ${message}`, {
              ...toolResult,
              code: codeBlock,
              suggestion: 'Look into error message and identify which commands passed and which failed. Continue execution using step-by-step approach using click() and type() tools.',
            });
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

export function createAgentTools({
  explorer,
  researcher,
  navigator,
}: {
  explorer: Explorer;
  researcher: Researcher;
  navigator: Navigator;
}): any {
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
            suggestion: 'If an expected data was seen on a page, call verify() to ensure it can be located in DOM',
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.toString() : 'Unknown error occurred';
          return failedToolResult('see', `See tool failed: ${errorMessage}`, {
            error: errorMessage,
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
          const action = explorer.createAction();
          const actionResult = await action.capturePageState();
          const verified = await navigator.verifyState(assertion, actionResult);

          if (verified) {
            return successToolResult('verify', {
              message: `Verification passed: ${assertion}`,
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

          const actionResult = ActionResult.fromState(currentState);
          const success = await navigator.resolveState(instruction, actionResult);

          if (success) {
            return successToolResult('interact', {
              message: `Successfully executed: ${instruction}`,
            });
          }

          return failedToolResult('interact', `Failed to execute: ${instruction}`, {
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
          return failedToolResult('visualClick', `visualClick tool failed: ${errorMessage}`);
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
  };
}

const PAGE_DIFF_SUGGESTION = 'Analyze page diff and plan next steps.';

function formatLocator(locator: string): string {
  try {
    const parsed = JSON.parse(locator);
    if (typeof parsed === 'object' && parsed !== null) {
      return JSON.stringify(parsed);
    }
  } catch {
    // Not JSON, treat as regular string
  }
  return JSON.stringify(locator);
}

function successToolResult(action: string, data?: Record<string, any>) {
  const result: Record<string, any> = { success: true, action, ...data };
  if (data?.pageDiff) {
    result.suggestion = data.suggestion ? `${data.suggestion} ${PAGE_DIFF_SUGGESTION}` : PAGE_DIFF_SUGGESTION;
  }
  return result;
}

function failedToolResult(action: string, message: string, data?: Record<string, any>) {
  const result: Record<string, any> = { success: false, action, message, ...data };
  if (data?.pageDiff) {
    result.suggestion = data.suggestion ? `${data.suggestion} ${PAGE_DIFF_SUGGESTION}` : PAGE_DIFF_SUGGESTION;
  }
  return result;
}
