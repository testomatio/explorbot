import { tool } from 'ai';
import dedent from 'dedent';
import { z } from 'zod';
import Action from '../action.js';
import { createDebug } from '../utils/logger.js';
import { loop } from '../utils/loop.js';
import { locatorRule, multipleLocatorRule } from './rules.ts';
import { htmlCombinedSnapshot } from '../utils/html.js';
import type Explorer from '../explorer.ts';
import { Researcher } from './researcher.ts';
import { Navigator } from './navigator.ts';

const debugLog = createDebug('explorbot:tools');

function successToolResult(action: string, data?: Record<string, any>) {
  return {
    success: true,
    action,
    ...data,
  };
}

function failedToolResult(action: string, message: string, data?: Record<string, any>) {
  return {
    success: false,
    action,
    message,
    ...data,
  };
}

export function createCodeceptJSTools(action: Action, noteFn: (note: string) => void = () => {}) {
  return {
    click: tool({
      description: dedent`
        Perform a click on an element by its locator. ARIA, CSS or XPath locators are equally supported.
        Prefer ARIA locators first over CSS or XPath locators.
        Follow semantic attributes when interacting with clickable elements like buttons, links, role=button etc, or elements have aria-label or aria-roledescription attributes.
        Can pass a text of clickable element instead of locator (click('Login'), click('Submit'), click('Save'), etc)

        ${locatorRule}

        Do not use :contains in locator, as click() searches an element by text by default.

        click('button:contains("Login")') use clickByText tool instead

        
      `,
      inputSchema: z.object({
        locator: z.string().describe('ARIA, CSS or XPath locator for the element to click.'),
        explanation: z.string().describe('Reason for selecting this click action.'),
      }),
      execute: async ({ locator, explanation }) => {
        noteFn(explanation);
        locator = stringToJson(locator);

        debugLog('Click locator:', locator);

        const clickSuccess = await action.attempt((I) => I.click(locator), explanation);
        if (clickSuccess) {
          await action.capturePageState();
          return successToolResult('click');
        }

        return failedToolResult('click', 'Click did not succeed.', {
          message: action.lastError ? action.lastError.toString() : '',
          suggestion: 'Try a different locator or interact using clickXY if coordinates are available.',
        });
      },
    }),

    clickByText: tool({
      description: dedent`
        Click on a button or link by its text within a specific context element.
        Use this when you need to click an element by text but there are multiple elements with the same text on the page.
        The context locator narrows down the search area to a specific container.

        Example: clickByText('Submit', '.modal-footer') - clicks Submit button inside modal footer
        Example: clickByText('Delete', '//div[@class="user-row"][1]') - clicks Delete in first user row
      `,
      inputSchema: z.object({
        text: z.string().describe('Text of the button or link to click'),
        context: z.string().describe('CSS or XPath locator for the container element to search within'),
        explanation: z.string().describe('Reason for selecting this click action.'),
      }),
      execute: async ({ text, context, explanation }) => {
        noteFn(explanation);
        context = stringToJson(context);

        debugLog('ClickByText:', text, 'in context:', context);

        const clickSuccess = await action.attempt((I) => I.click(text, context), explanation);
        if (clickSuccess) {
          await action.capturePageState();
          return successToolResult('clickByText');
        }

        return failedToolResult('clickByText', 'Click by text did not succeed.', {
          message: action.lastError ? action.lastError.toString() : '',
          suggestion: 'Verify the text matches exactly and the context locator is correct. Try using click() with a more specific locator instead.',
        });
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
        if (explanation) noteFn(explanation);
        const success = await action.attempt((I) => I.clickXY(x, y), explanation);

        await action.capturePageState();

        if (success) {
          return successToolResult('clickXY');
        }

        return failedToolResult('clickXY', 'Click by coordinates failed.', {
          ...(action.lastError && { error: action.lastError.toString() }),
        });
      },
    }),

    type: tool({
      description: 'Send keyboard input to a field by its locator. After typing, the page state will be automatically captured and returned.',
      inputSchema: z.object({
        text: z.string().describe('The text to type'),
        locator: z.string().optional().describe('CSS or XPath locator for the field to fill'),
        explanation: z.string().optional().describe('Reason for providing this input.'),
      }),
      execute: async ({ text, locator, explanation }) => {
        if (explanation) noteFn(explanation);
        const selectAllKey = ['CommandOrControl', 'a'];

        if (locator) {
          locator = stringToJson(locator);
          await action.attempt((I) => I.fillField(locator, text), explanation);

          if (!action.lastError) {
            return successToolResult('type', {
              message: `Input field ${locator} was filled with value ${text}`,
            });
          }
        }

        await action.attempt((I) => I.click(locator), explanation);

        await action.attempt(async (I) => {
          await I.pressKey(selectAllKey);
          await I.pressKey('Delete');
          await I.type(text);
        }, explanation);

        if (!action.lastError) {
          return successToolResult('type', {
            message: 'type() tool worked by clicking element and typing in values',
          });
        }

        await action.capturePageState();

        return failedToolResult('type', `type() tool failed ${action.lastError?.toString()}`, {
          suggestion: 'Try again with different locator or use clickXY tool to click on the element by coordinates and then calling type() without a locator',
        });
      },
    }),

    form: tool({
      description: dedent`
        Use this tools to run a code block with miltiple codeceptjs commands
        When you have a form on a page or multiple input elements to interact with.
        Prefer using form() when interacting with iframe elements, switch to iframe context with I.switchTo(<iframe_locator>)
        Prefer to use it instead of click() and type() when dealing with multiple elements.
        Do not submit form, just fill it in

        Provide valid CodeceptJS code that starts with I. and can contain multiple commands separated by newlines.

        Example:
        I.fillField('title', 'My Article')
        I.selectOption('category', 'Technology')

        ${locatorRule}

        Prefer stick to action commands like click, fillField, selectOption, etc.
        Do not use wait functions like waitForText, waitForElement, etc.
        Do not use other commands than action commands.
        Do not change navigation with I.amOnPage() or I.reloadPage()
        Do not save screenshots with I.saveScreenshot()
      `,
      inputSchema: z.object({
        codeBlock: z.string().describe('Valid CodeceptJS code starting with I. Can contain multiple commands separated by newlines.'),
        explanation: z.string().describe('Reason for submitting this form sequence.'),
      }),
      execute: async ({ codeBlock, explanation }) => {
        noteFn(explanation);
        if (!codeBlock.trim()) {
          return failedToolResult('form', 'CodeBlock cannot be empty');
        }

        const lines = codeBlock
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line);
        const codeLines = lines.filter((line) => !line.startsWith('//'));

        if (!codeLines.every((line) => line.startsWith('I.'))) {
          return failedToolResult('form', 'All non-comment lines must start with I.', {
            suggestion: 'Try again but pass valid CodeceptJS code where every non-comment line starts with I.',
          });
        }

        await action.attempt(codeBlock, explanation);

        if (action.lastError) {
          const message = action.lastError ? String(action.lastError) : 'Unknown error';
          return failedToolResult('form', `Form execution FAILED! ${message}`, {
            suggestion: dedent`
              Look into error message and identify which commands passed and which failed.
              Continue execution using step-by-step approach using click() and type() tools.`,
          });
        }

        await action.capturePageState();

        return successToolResult('form', {
          message: `Form completed successfully with ${lines.length} commands.`,
          suggestion: 'Verify the form was filled in correctly using see() tool. Submit if needed by using click() tool.',
          commandsExecuted: lines.length,
        });
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
        Check the page contents based on current page state and screenshot
        This tool will trigger visual research to check the page contents on request
        Use it to to verify the actions were performed correctly and the page is in the expected state

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

          const analysisResult = await researcher.imageContent(actionResult, request);

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

    verify: tool({
      description: dedent`
        Verify an assertion about the current page state using AI-powered verification.
        This tool uses the Navigator's verifyState method to check if the page matches the expected condition.
        Do not ask research for the same page you already researched.
        The AI will attempt multiple verification strategies using CodeceptJS assertions.
      `,
      inputSchema: z.object({
        assertion: z.string().describe('The assertion or condition to verify on the current page (e.g., "User is logged in", "Form validation error is displayed")'),
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
        This tool provides a comprehensive UI map report including forms, buttons, menus, and other interactive elements.
        Use it when you need to understand the page layout before interacting with it.
      `,
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const stateManager = explorer.getStateManager();
          const currentState = stateManager.getCurrentState();

          if (!currentState) {
            return failedToolResult('research', 'No current page state available. Navigate to a page first.');
          }

          const researchResult = await researcher.research(currentState, { screenshot: true });

          return successToolResult('research', {
            analysis: researchResult,
            message: `Successfully researched page: ${currentState.url}.`,
            suggestion: 'You received comprehensive UI map report. Use it to understand the page structure and navigate to the elements. Do not ask for research() if you have <page_ui_map> for current page.',
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.toString() : 'Unknown error occurred';
          return failedToolResult('research', `Research tool failed: ${errorMessage}`, {
            error: errorMessage,
          });
        }
      },
    }),
  };
}

function stringToJson(str: string): any {
  if (!str) return null;
  const firstWord = str.split(' ')[0];
  if (['link', 'button', 'input', 'select', 'textarea', 'option', 'combobox'].includes(firstWord)) {
    return {
      role: firstWord,
      text: str
        .slice(firstWord.length)
        .trim()
        .replace(/^['"]|['"]$/g, ''),
    };
  }
  if (str.startsWith('{') && str.endsWith('}')) {
    return JSON.parse(str);
  }
  return str;
}
