import { tool } from 'ai';
import dedent from 'dedent';
import { z } from 'zod';
import { platform } from 'node:os';
import Action from '../action.js';
import { createDebug } from '../utils/logger.js';
import { loop } from '../utils/loop.js';
import { locatorRule, multipleLocatorRule } from './rules.ts';

const debugLog = createDebug('explorbot:tools');

export function clearToolCallHistory() {}

export function createCodeceptJSTools(action: Action) {
  return {
    click: tool({
      description: dedent`
        Perform a click on an element by its locator. ARIA, CSS or XPath locators are equally supported.
        Prefer ARIA locators first over CSS or XPath locators.
        Follow semantic attributes when interacting with clickable elements like buttons, links, role=button etc, or elements have aria-label or aria-roledescription attributes.

        ${locatorRule}
      `,
      inputSchema: z.object({
        locator: z.string().describe('ARIA, CSS or XPath locator for the element to click.'),
        explanation: z.string().describe('Reason for selecting this click action.'),
      }),
      execute: async ({ locator, explanation }) => {
        let result: any = {
          success: false,
          message: 'Nothing was executed',
          action: 'click',
          suggestion: 'Try again with different locator',
          explanation,
        };

        if (locator.startsWith('{') && locator.endsWith('}')) {
          locator = JSON.parse(locator);
        }

        const clickSuccess = await action.attempt((I) => I.click(locator), explanation);
        if (clickSuccess) {
          await action.capturePageState();

          result = {
            success: true,
            action: 'click',
            locator,
            explanation,
          };
          return result;
        }

        let errorMessage = action.lastError ? action.lastError.toString() : '';

        const forceClickSuccess = await action.attempt((I) => I.forceClick(locator), explanation);
        if (forceClickSuccess) {
          await action.capturePageState();
          result = {
            success: true,
            action: 'click',
            locator,
            explanation,
            message: 'Click succeeded but ignoring visibility checks. Element may behave unexpectedly',
            suggestion: 'Next time use clickXY tool for this element, and click on it by X, Y coordinates if they are available.',
          };
          return result;
        }

        if (action.lastError) {
          errorMessage = action.lastError.toString();
        }

        const elementVisible = await action.attempt((I) => I.seeElement(locator), explanation);

        await action.capturePageState();

        if (!elementVisible) {
          result = {
            success: false,
            action: 'click',
            locator,
            explanation,
            message: 'The element is either not visible or not clickable',
            suggestion: dedent`
              Do not try to interact with this element by any locator.
              Try clicking it by coordinates using clickXY tool if they are available.
              If it is not possible suggest a different approach.
            `,
          };
          if (errorMessage) {
            result.error = errorMessage;
          }
          return result;
        }

        result = {
          success: false,
          action: 'click',
          locator,
          explanation,
          message: 'Click did not succeed even though the element is visible.',
          suggestion: 'Try a different locator or interact using clickXY if coordinates are available.',
        };
        if (errorMessage) {
          result.error = errorMessage;
        }
        return result;
      },
    }),

    seeElement: tool({
      description: dedent`
        Quickly verify that an element became visible or interactable.
        Use it to confirm alerts, dropdowns, toolbars, or overlays appeared.
        Provide several locator options if there are alternative selectors for the same element.

        ${locatorRule}
        ${multipleLocatorRule}
      `,
      inputSchema: z.object({
        locators: z.array(z.string()).min(1).describe('Array of locators to check sequentially until one is found. Must provide at least one locator.'),
        explanation: z.string().describe('Reason for verifying element visibility.'),
      }),
      execute: async ({ locators, explanation }) => {
        if (!locators.length) {
          return {
            success: false,
            action: 'seeElement',
            message: 'Provide at least one locator to verify.',
            suggestion: 'Add CSS or XPath selector that should match the element.',
            explanation,
          };
        }

        let result: any = {
          success: false,
          action: 'seeElement',
          explanation,
        };

        await loop(
          async ({ stop }) => {
            const locator = locators.shift();
            if (!locator) {
              stop();
              return;
            }

            await action.attempt((I) => I.seeElement(locator), explanation);

            if (action.lastError) {
              result = {
                success: false,
                action: 'seeElement',
                locator,
                explanation,
                message: `Failed to confirm element visibility with provided locators ${locator}.`,
              };
              return;
            }

            const html = await action.getActor().grabHtmlFrom(locator);

            result = {
              success: true,
              action: 'seeElement',
              locator,
              explanation,
              elementHtml: html || '',
            };
            stop();
          },
          { maxAttempts: locators.length }
        );

        return result;
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
        explanation: z.string().describe('Reason for clicking by coordinates.'),
      }),
      execute: async ({ x, y, explanation }) => {
        const success = await action.attempt(
          (I) =>
            I.usePlaywrightTo('click by coordinates', async ({ page }: { page: any }) => {
              await page.mouse.click(x, y);
            }),
          explanation
        );

        await action.capturePageState();

        if (success) {
          return {
            success: true,
            action: 'clickXY',
            x,
            y,
            explanation,
          };
        }

        const result: any = {
          success: false,
          action: 'clickXY',
          x,
          y,
          explanation,
          message: 'Click by coordinates failed.',
        };

        if (action.lastError) {
          result.error = action.lastError.toString();
        }

        return result;
      },
    }),

    type: tool({
      description: 'Send keyboard input to a field by its locator. After typing, the page state will be automatically captured and returned.',
      inputSchema: z.object({
        text: z.string().describe('The text to type'),
        locator: z.string().describe('CSS or XPath locator for the field to fill'),
        explanation: z.string().describe('Reason for providing this input.'),
      }),
      execute: async ({ text, locator, explanation }) => {
        const selectAllKey = ['CommandOrControl', 'a'];

        await action.attempt((I) => I.fillField(locator, text), explanation);

        if (!action.lastError) {
          return {
            success: true,
            message: `Input field ${locator} was filled with value ${text}`,
            action: 'type',
            locator,
            text,
            explanation,
          };
        }

        await action.attempt((I) => I.click(locator), explanation);

        await action.attempt(async (I) => {
          await I.pressKey(selectAllKey);
          await I.pressKey('Delete');
          await I.type(text);
        }, explanation);

        if (!action.lastError) {
          return {
            success: true,
            action: 'type',
            locator,
            text,
            explanation,
            message: 'type() tool worked by clicking element and typing in values',
          };
        }

        await action.capturePageState();

        return {
          success: false,
          action: 'type',
          locator,
          text,
          explanation,
          message: `type() tool failed ${action.lastError?.toString()}`,
          suggestion: 'Try again with different locator or use clickXY tool to click on the element by coordinates and then calling type() without a locator',
        };
      },
    }),

    form: tool({
      description: dedent`
        Use this tools to run a code block with miltiple codeceptjs commands
        When you have a form on a page or multiple input elements to interact with.
        Prefer using form() when interacting with iframe elements, switch to iframe context with I.switchTo(<iframe_locator>)
        Prefer to use it instead of click() and type() when dealing with multiple elements.

        Provide valid CodeceptJS code that starts with I. and can contain multiple commands separated by newlines.

        Example:
        I.fillField('title', 'My Article')
        I.selectOption('category', 'Technology')
        I.click('Save')

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
        if (!codeBlock.trim()) {
          return {
            success: false,
            message: 'CodeBlock cannot be empty',
            action: 'form',
            codeBlock,
            explanation,
          };
        }

        const lines = codeBlock
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line);
        const codeLines = lines.filter((line) => !line.startsWith('//'));

        if (!codeLines.every((line) => line.startsWith('I.'))) {
          return {
            success: false,
            message: 'All non-comment lines must start with I.',
            action: 'form',
            suggestion: 'Try again but pass valid CodeceptJS code where every non-comment line starts with I.',
            codeBlock,
            explanation,
          };
        }

        await action.attempt(codeBlock, explanation);

        if (action.lastError) {
          const message = action.lastError ? String(action.lastError) : 'Unknown error';
          return {
            success: false,
            message: `Form execution FAILED! ${message}`,
            suggestion: "Try again looking at the error message. If this won't work use different locators or fill the fields one by one using click() and type() tools",
            action: 'form',
            codeBlock,
            explanation,
          };
        }

        await action.capturePageState();

        return {
          success: true,
          message: `Form completed successfully with ${lines.length} commands`,
          action: 'form',
          codeBlock,
          commandsExecuted: lines.length,
          explanation,
        };
      },
    }),

    see: tool({
      description: dedent`
        Take a screenshot and use AI to analyze if the page contains the requested element.
        This tool is useful for verifying visual elements that may be difficult to locate with traditional selectors.
        The AI will analyze the screenshot and determine if the requested element is present and usable.
      `,
      inputSchema: z.object({
        request: z.string().describe('Description of the element or content to look for in the screenshot'),
        explanation: z.string().describe('Reason for searching for this element'),
      }),
      execute: async ({ request, explanation }) => {
        try {
          const actionResult = await action.caputrePageWithScreenshot();

          if (!actionResult.screenshot) {
            return {
              success: false,
              action: 'see',
              request,
              explanation,
              message: 'Failed to capture screenshot for analysis',
            };
          }

          const explorer = action.getExplorer();
          if (!explorer) {
            return {
              success: false,
              action: 'see',
              request,
              explanation,
              message: 'Explorer not available for AI analysis',
            };
          }

          const researcher = explorer.getResearcher();
          if (!researcher) {
            return {
              success: false,
              action: 'see',
              request,
              explanation,
              message: 'Researcher not available for AI analysis',
            };
          }

          const currentState = actionResult.getState();
          const analysisResult = await researcher.imageContent(currentState, request);

          if (!analysisResult) {
            return {
              success: false,
              action: 'see',
              request,
              explanation,
              message: 'AI analysis failed to process the screenshot',
            };
          }

          return {
            success: true,
            action: 'see',
            request,
            explanation,
            analysis: analysisResult,
            message: `Successfully analyzed screenshot for: ${request}`,
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.toString() : 'Unknown error occurred';
          return {
            success: false,
            action: 'see',
            request,
            explanation,
            message: `See tool failed: ${errorMessage}`,
            error: errorMessage,
          };
        }
      },
    }),
  };
}
