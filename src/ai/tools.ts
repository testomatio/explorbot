import { tool } from 'ai';
import dedent from 'dedent';
import { z } from 'zod';
import Action from '../action.js';
import { createDebug } from '../utils/logger.js';
import { loop } from '../utils/loop.js';
import { locatorRule, multipleLocatorRule } from './rules.ts';

const debugLog = createDebug('explorbot:tools');

const recentToolCalls: string[] = [];

function hasBeenCalled(actionName: string, params: Record<string, any>, stateHash: string): boolean {
  const callKey = `${stateHash}:${actionName}:${JSON.stringify(params)}`;
  const len = recentToolCalls.length;

  if (len >= 2 && recentToolCalls[len - 1] === callKey && recentToolCalls[len - 2] === callKey) {
    return true;
  }

  recentToolCalls.push(callKey);
  return false;
}

export function clearToolCallHistory() {
  recentToolCalls.length = 0;
}

export function toolAction(action: Action, codeFunction: (I: any) => void, actionName: string, params: Record<string, any>): any {
  return async () => {
    const currentState = action.stateManager.getCurrentState();
    const stateHash = currentState?.hash || 'unknown';

    if (hasBeenCalled(actionName, params, stateHash)) {
      const paramsStr = JSON.stringify(params);
      return {
        success: false,
        message: `This exact tool call was already attempted 3+ times consecutively with the same state and failed: ${actionName}(${paramsStr}). The page state has not changed. Try a completely different approach, use a different locator, or call reset() or stop() if available.`,
        action: actionName,
        ...params,
        duplicate: true,
      };
    }

    try {
      await action.execute(codeFunction);

      if (action.lastError) {
        throw action.lastError;
      }

      const actionResult = action.getActionResult();
      if (!actionResult) {
        throw new Error(`${actionName} executed but no action result available`);
      }
      return {
        success: true,
        action: actionName,
        ...params,
      };
    } catch (error) {
      debugLog(`${actionName} failed: ${error}`);
      return {
        success: false,
        message: `Tool call has FAILED! ${String(error)}`,
        action: actionName,
        ...params,
      };
    }
  };
}

export function createCodeceptJSTools(action: Action) {
  return {
    click: tool({
      description: dedent`
        Perform a click on an element by its locator. CSS or XPath locator are equally supported.
        Prefer click on clickable elements like buttons, links, role=button etc, or elements have aria-label or aria-roledescription attributes.
        Provide multiple locator alternatives to click the same element to increase chance of success.

        ${locatorRule}
        ${multipleLocatorRule}
      `,
      inputSchema: z.object({
        locators: z.array(z.string()).describe('Array of CSS or XPath locators to try in order. Will try each locator until one succeeds.'),
      }),
      execute: async ({ locators }) => {
        let result = {
          success: false,
          message: 'Noting was executed',
          action: 'click',
        };
        await loop(
          async ({ stop }) => {
            const currentLocator = locators.shift();

            if (!currentLocator) stop();

            result = await toolAction(action, (I) => I.click(currentLocator), 'click', { locator: currentLocator })();
            if (result.success) stop();

            // auto force click if previous click failed
            result = await toolAction(action, (I) => I.forceClick(currentLocator), 'click', { locator: currentLocator })();

            if (result.success) {
              stop();
            }
          },
          {
            maxAttempts: locators.length,
          }
        );
      },
    }),

    type: tool({
      description: 'Send keyboard input to the active element or fill a field. After typing, the page state will be automatically captured and returned.',
      inputSchema: z.object({
        text: z.string().describe('The text to type'),
        locator: z.string().optional().describe('Optional CSS or XPath locator to focus on before typing'),
      }),
      execute: async ({ text, locator }) => {
        if (!locator) {
          return await toolAction(action, (I) => I.type(text), 'type', { text })();
        }

        let result = await toolAction(action, (I) => I.fillField(locator, text), 'type', { text, locator })();
        if (!result.success) {
          // let's click and type instead.
          await toolAction(action, (I) => I.click(locator), 'click', { locator })();
          await action.waitForInteraction();
          // it's ok even if click not worked, we still can type if element is already focused
          result = await toolAction(action, (I) => I.type(text), 'type', { text })();
        }
        return result;
      },
    }),

    form: tool({
      description: dedent`
        Execute a sequence of CodeceptJS commands for form interactions.
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
      }),
      execute: async ({ codeBlock }) => {
        if (!codeBlock.trim()) {
          return {
            success: false,
            message: 'CodeBlock cannot be empty',
            action: 'form',
            codeBlock,
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
          };
        }

        try {
          await action.execute(codeBlock);

          if (action.lastError) {
            throw action.lastError;
          }

          const actionResult = action.getActionResult();
          if (!actionResult) {
            throw new Error('Form executed but no action result available');
          }

          return {
            success: true,
            message: `Form completed successfully with ${lines.length} commands`,
            action: 'form',
            codeBlock,
            commandsExecuted: lines.length,
          };
        } catch (error) {
          debugLog(`Form failed: ${error}`);
          return {
            success: false,
            message: `Form execution FAILED! ${String(error)}`,
            action: 'form',
            codeBlock,
          };
        }
      },
    }),
  };
}
