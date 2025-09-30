import { tool } from 'ai';
import dedent from 'dedent';
import { z } from 'zod';
import Action from '../action.js';
import { createDebug, tag } from '../utils/logger.js';

const debugLog = createDebug('explorbot:tools');

export function toolAction(action: Action, codeFunction: (I: any) => void, actionName: string, params: Record<string, any>) {
  return async () => {
    try {
      await action.execute(codeFunction);

      if (action.lastError) {
        throw action.lastError;
      }

      const actionResult = action.getActionResult();
      if (!actionResult) {
        throw new Error(`${actionName} executed but no action result available`);
      }

      tag('success').log(`✅ ${actionName} successful → ${actionResult.url} "${actionResult.title}"`);
      return {
        success: true,
        action: actionName,
        ...params,
        pageState: actionResult,
      };
    } catch (error) {
      debugLog(`${actionName} failed: ${error}`);
      tag('error').log(`❌ ${actionName} failed: ${error}`);
      return {
        success: false,
        action: actionName,
        ...params,
        error: String(error),
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
        tag('substep').log(`🖱️ AI Tool: click("${locator}")`);
        if (force) {
          tag('substep').log(`🖱️ AI Tool: click("${locator}", { force: true })`);
          return await toolAction(action, (I) => I.forceClick(locator), 'click', { locator })();
        }
        return await toolAction(action, (I) => I.click(locator), 'click', { locator })();
      },
    }),

    type: tool({
      description: 'Send keyboard input to the active element or fill a field. After typing, the page state will be automatically captured and returned.',
      inputSchema: z.object({
        text: z.string().describe('The text to type'),
        locator: z.string().optional().describe('Optional CSS or XPath locator to focus on before typing'),
      }),
      execute: async ({ text, locator }) => {
        const locatorMsg = locator ? ` in: ${locator}` : '';
        tag('substep').log(`⌨️ AI Tool: type("${text}")${locatorMsg}`);
        debugLog(`Typing text: ${text}`, locator ? `in: ${locator}` : '');

        const codeFunction = locator ? (I: any) => I.fillField(locator, text) : (I: any) => I.type(text);
        return await toolAction(action, codeFunction, 'type', { text, locator })();
      },
    }),
  };
}
