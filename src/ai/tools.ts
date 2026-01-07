import { tool } from 'ai';
import dedent from 'dedent';
import { z } from 'zod';
import { ActionResult, type ToolResultMetadata } from '../action-result.ts';
import type Explorer from '../explorer.ts';
import { TestResult, type Task } from '../test-plan.js';
import { createDebug } from '../utils/logger.js';
import { Navigator } from './navigator.ts';
import { Researcher } from './researcher.ts';
import { sectionContextRule, sectionUiMapRule } from './rules.ts';

const debugLog = createDebug('explorbot:tools');

export const CODECEPT_TOOLS = ['click', 'clickByText', 'clickXY', 'type', 'select', 'form'] as const;

export function createCodeceptJSTools(explorer: Explorer, task: Task) {
  const stateManager = explorer.getStateManager();

  return {
    click: tool({
      description: dedent`
        Perform a click on an element by its locator. Prefer ARIA locators as the main argument.
        Use CSS or XPath locators only when ARIA is not available.
        Follow semantic attributes when interacting with clickable elements like buttons, links, role=button etc, or elements have aria-label or aria-roledescription attributes.
        To click by text, use clickByText() tool instead.

        Follow <locator_priority> rules from system prompt for locator selection.

        AVOID :contains CSS pseudo-selector - it is not supported! Use clickByText() instead.
      `,
      inputSchema: z.object({
        locator: z.string().describe('ARIA, CSS or XPath locator for the element to click.'),
        container: z.string().optional().describe('CSS selector that shows where we need to perform action'),
        explanation: z.string().describe('Reason for selecting this click action.'),
      }),
      execute: async ({ locator, container, explanation }) => {
        const activeNote = task.startNote(explanation);
        try {
          debugLog('Click locator:', locator);

          const previousState = ActionResult.fromState(stateManager.getCurrentState()!);
          const action = explorer.createAction();
          const clickCommand = container ? `I.click(${formatLocator(locator)}, ${formatLocator(container)})` : `I.click(${formatLocator(locator)})`;
          const clickSuccess = await action.attempt(clickCommand, explanation);

          const toolResult = await ActionResult.fromState(stateManager.getCurrentState()!).toToolResult(previousState, locator);

          if (clickSuccess) {
            activeNote.commit(TestResult.PASSED);
            return successToolResult('click', { ...toolResult, code: clickCommand });
          }

          const page = !toolResult?.pageDiff && ActionResult.fromState(stateManager.getCurrentState()!).toAiContext();
          const errorMsg = action.lastError?.toString() || 'Click did not succeed';

          activeNote.commit(TestResult.FAILED);
          return failedToolResult('click', errorMsg, {
            ...toolResult,
            page,
            code: clickCommand,
            suggestion: 'Try a different locator or use visualClick() tool for visual fallback.',
          });
        } catch (error) {
          activeNote.commit(TestResult.FAILED);
          const errorMessage = error instanceof Error ? error.toString() : 'Unknown error occurred';
          return failedToolResult('click', `Click tool failed: ${errorMessage}`);
        }
      },
    }),

    clickByText: tool({
      description: dedent`
        Click on a button or link by its text or ARIA locator within a specific container element.
        Use this instead of click() when you need container parameter to narrow the search area.

        Main difference from click():
        - click(locator) - clicks by locator directly, no container parameter
        - clickByText(text, container) - clicks by text within a container

        Example: clickByText('Submit', '.modal-footer') - clicks Submit button inside modal footer
        Example: clickByText('Delete', '//div[@class="user-row"][1]') - clicks Delete in first user row
        Example: clickByText({ role: 'button', text: 'Delete' }, '.item-1') - clicks Delete in item 1

        Follow <locator_priority> rules from system prompt for locator selection.
        DO NOT PICK body, html as container. Be specific about the container element in HTML.
        Request HTML context if needed to provide valid CSS locator
      `,
      inputSchema: z.object({
        text: z.string().describe('Text of the button or link to click'),
        container: z.string().describe('CSS locator for the container element to search within'),
        explanation: z.string().describe('Reason for selecting this click action.'),
      }),
      execute: async ({ text, container, explanation }) => {
        const activeNote = task.startNote(explanation);
        try {
          debugLog('ClickByText:', text, 'in container:', container);

          const previousState = ActionResult.fromState(stateManager.getCurrentState()!);
          const action = explorer.createAction();
          const clickCommand = `I.click(${JSON.stringify(text)}, ${formatLocator(container)})`;
          const clickSuccess = await action.attempt(clickCommand, explanation);

          const toolResult = await ActionResult.fromState(stateManager.getCurrentState()!).toToolResult(previousState, text);

          if (clickSuccess) {
            activeNote.commit(TestResult.PASSED);
            return successToolResult('clickByText', { ...toolResult, code: clickCommand });
          }

          const errorMsg = action.lastError ? action.lastError.toString() : 'Click by text did not succeed';
          activeNote.commit(TestResult.FAILED);
          return failedToolResult('clickByText', errorMsg, {
            ...toolResult,
            error: errorMsg,
            code: clickCommand,
            suggestion: 'Verify text and container. If still failing, use visualClick() for visual fallback.',
          });
        } catch (error) {
          activeNote.commit(TestResult.FAILED);
          const errorMessage = error instanceof Error ? error.toString() : 'Unknown error occurred';
          return failedToolResult('clickByText', `ClickByText tool failed: ${errorMessage}`);
        }
      },
    }),

    clickXY: tool({
      description: dedent`
        Click on the page at the provided x and y coordinates instead of HTML locators.
        Use it when native click() tool didn't work
        Pick correct coordinates from <visual_ui_map> to access it.
      `,
      inputSchema: z.object({
        x: z.number().describe('X coordinate in pixels'),
        y: z.number().describe('Y coordinate in pixels'),
        explanation: z.string().optional().describe('Reason for clicking by coordinates.'),
      }),
      execute: async ({ x, y, explanation }) => {
        const activeNote = explanation ? task.startNote(explanation) : task.startNote(`Click at coordinates (${x}, ${y})`);
        try {
          const previousState = ActionResult.fromState(stateManager.getCurrentState()!);
          const coordLocator = `(${x}, ${y})`;
          const action = explorer.createAction();
          const clickCommand = `I.clickXY(${x}, ${y})`;
          const success = await action.attempt(clickCommand, explanation);

          const toolResult = await ActionResult.fromState(stateManager.getCurrentState()!).toToolResult(previousState, coordLocator);

          if (success) {
            activeNote.commit(TestResult.PASSED);
            return successToolResult('clickXY', { ...toolResult, code: clickCommand });
          }

          const errorMsg = action.lastError?.toString() || 'Click by coordinates failed';
          activeNote.commit(TestResult.FAILED);
          return failedToolResult('clickXY', errorMsg, {
            ...toolResult,
            ...(action.lastError && { error: action.lastError.toString() }),
            code: clickCommand,
            suggestion: 'Use see() to verify correct coordinates from the screenshot.',
          });
        } catch (error) {
          activeNote.commit(TestResult.FAILED);
          const errorMessage = error instanceof Error ? error.toString() : 'Unknown error occurred';
          return failedToolResult('clickXY', `ClickXY tool failed: ${errorMessage}`);
        }
      },
    }),

    type: tool({
      description: dedent`
        Send keyboard input to a field. After typing, the page state will be automatically captured and returned.
        Omit locator if input is already focused.

        Follow <locator_priority> rules from system prompt for locator selection.
      `,
      inputSchema: z.object({
        text: z.string().describe('The text to type'),
        locator: z.string().optional().describe('ARIA, CSS or XPath locator for the field. If omitted, types into currently focused element.'),
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

        Follow <locator_priority> rules from system prompt for locator selection.

        <example>
          I.selectOption('Country', 'United States');
          I.selectOption({ role: 'combobox', text: 'Select country' }, 'USA');
          I.selectOption('#country-select', 'US');
          I.selectOption('[name="country"]', 'United States');
        </example>
      `,
      inputSchema: z.object({
        locator: z.string().describe('ARIA, CSS, XPath locator, or label text for the select/combobox element'),
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

    form: tool({
      description: dedent`
        Execute raw CodeceptJS code block with multiple commands.

        Use cases:
        - Working with iframes (switch context with I.switchTo)
        - Performing multiple form actions in a single batch
        - Complex interactions requiring sequential commands

        Example - filling a form:
        I.fillField('title', 'My Article')
        I.selectOption('category', 'Technology')

        Example - working with iframe:
        I.switchTo('#payment-iframe')
        I.fillField('card', '4242424242424242')
        I.fillField('cvv', '123')
        I.switchTo()

        Follow <locator_priority> rules from system prompt for locator selection.

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
        - click() or clickByText() failed multiple times
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
