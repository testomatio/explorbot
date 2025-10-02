import { tool } from 'ai';
import dedent from 'dedent';
import { z } from 'zod';
import Action from '../action.js';
import { createDebug } from '../utils/logger.js';

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
        message: 'Tool call has FAILED! ' + String(error),
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
      `,
      inputSchema: z.object({
        locator: z.string().describe('CSS or XPath locator of target element'),
        force: z.boolean().optional().describe('Force click even if the element is not visible. If previous click didn\t work, try again with force: true'),
      }),
      execute: async ({ locator, force }) => {
        if (force) {
          return await toolAction(action, (I) => I.forceClick(locator), 'click', { locator })();
        }
        let result = await toolAction(action, (I) => I.click(locator), 'click', { locator })();
        if (!result.success && !force) {
          // auto force click if previous click failed
          result = await toolAction(action, (I) => I.forceClick(locator), 'click', { locator })();
        }
        if (!result.success) {
          result.suggestion = `
            Check the last HTML sample, do not interact with this element if it is not in HTML.
            If element exists in HTML, try to use click() with force: true option to click on it.
            If multiple calls to click failed you are probably on wrong page. Use reset() tool if it is available.
          `;
        }
        return result;
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
          result = await toolAction(action, (I) => I.type(text), 'type', { text, locator })();
        }
        return result;
      },
    }),
  };
}
