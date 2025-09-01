import { tool } from 'ai';
import { z } from 'zod';
import { createDebug } from '../utils/logger.js';
import { ActionResult } from '../action-result.js';

const debugLog = createDebug('explorbot:tools');

async function capturePageState(actor: any): Promise<ActionResult> {
  try {
    const url = await actor.grabCurrentUrl();
    const title = await actor.grabTitle();
    const html = await actor.grabHTMLFrom('body');

    // Try to get screenshot if possible
    let screenshot = null;
    try {
      screenshot = await actor.saveScreenshot();
    } catch (error) {
      debugLog('Could not capture screenshot:', error);
    }

    return new ActionResult({
      url,
      title,
      html,
      screenshot,
      timestamp: new Date(),
    });
  } catch (error) {
    throw new Error(`Failed to capture page state: ${error}`);
  }
}

export function createCodeceptJSTools(actor: any) {
  return {
    click: tool({
      description:
        'Click on an element by locator (text, CSS selector, XPath). After clicking, the page state will be automatically captured and returned.',
      parameters: z.object({
        locator: z
          .string()
          .describe(
            'The locator for the element to click (text, CSS selector, XPath)'
          ),
        context: z
          .string()
          .optional()
          .describe('Optional context element to search within'),
      }),
      execute: async ({ locator, context }) => {
        debugLog(
          `Clicking element: ${locator}`,
          context ? `within: ${context}` : ''
        );
        try {
          if (context) {
            await actor.click(locator, context);
          } else {
            await actor.click(locator);
          }

          // Capture new page state after click
          const newState = await capturePageState(actor);

          return {
            success: true,
            action: 'click',
            locator,
            context,
            pageState: {
              url: newState.url,
              title: newState.title,
              html: await newState.simplifiedHtml(),
            },
          };
        } catch (error) {
          debugLog(`Click failed: ${error}`);
          return {
            success: false,
            action: 'click',
            locator,
            context,
            error: String(error),
          };
        }
      },
    }),

    type: tool({
      description:
        'Send keyboard input to the active element or fill a field. After typing, the page state will be automatically captured and returned.',
      parameters: z.object({
        text: z.string().describe('The text to type'),
        locator: z
          .string()
          .optional()
          .describe('Optional locator to focus on before typing'),
      }),
      execute: async ({ text, locator }) => {
        debugLog(`Typing text: ${text}`, locator ? `in: ${locator}` : '');
        try {
          if (locator) {
            await actor.fillField(locator, text);
          } else {
            await actor.type(text);
          }

          // Capture new page state after typing
          const newState = await capturePageState(actor);

          return {
            success: true,
            action: 'type',
            text,
            locator,
            pageState: {
              url: newState.url,
              title: newState.title,
              html: await newState.simplifiedHtml(),
            },
          };
        } catch (error) {
          debugLog(`Type failed: ${error}`);
          return {
            success: false,
            action: 'type',
            text,
            locator,
            error: String(error),
          };
        }
      },
    }),
  };
}
