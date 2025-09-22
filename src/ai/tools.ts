import { tool } from 'ai';
import { z } from 'zod';
import { createDebug, tag } from '../utils/logger.js';
import { ActionResult } from '../action-result.js';
import dedent from 'dedent';

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
      description: dedent`
        Perform a click on an element by its locator. CSS or XPath locator are equally supported.
      `,
      inputSchema: z.object({
        locator: z.string().describe(
          dedent`
              CSS or XPath locator of target element
            `
        ),
      }),
      execute: async ({ locator }) => {
        tag('substep').log(`🖱️ AI Tool: click("${locator}")`);
        debugLog(`Clicking element: ${locator}`);

        try {
          await actor.click(locator);

          // Capture new page state after click
          let pageState = null;
          try {
            pageState = await capturePageState(actor);
            tag('success').log(
              `✅ Click successful → ${pageState.url} "${pageState.title}"`
            );
          } catch (stateError) {
            debugLog(`Page state capture failed after click: ${stateError}`);
            tag('warning').log(
              `⚠️ Click executed but page state capture failed: ${stateError}`
            );
          }

          return {
            success: true,
            action: 'click',
            locator,
            pageState,
          };
        } catch (error) {
          debugLog(`Click failed: ${error}`);
          tag('error').log(`❌ Click failed: ${error}`);
          return {
            success: false,
            action: 'click',
            locator,
            error: String(error),
          };
        }
      },
    }),

    type: tool({
      description:
        'Send keyboard input to the active element or fill a field. After typing, the page state will be automatically captured and returned.',
      inputSchema: z.object({
        text: z.string().describe('The text to type'),
        locator: z
          .string()
          .optional()
          .describe('Optional CSS or XPath locator to focus on before typing'),
      }),
      execute: async ({ text, locator }) => {
        const locatorMsg = locator ? ` in: ${locator}` : '';

        tag('substep').log(`⌨️ AI Tool: type("${text}")${locatorMsg}`);
        debugLog(`Typing text: ${text}`, locator ? `in: ${locator}` : '');

        try {
          if (locator) {
            await actor.fillField(locator, text);
          } else {
            await actor.type(text);
          }

          // Capture new page state after typing
          try {
            const newState = await capturePageState(actor);
            tag('success').log(
              `✅ Type successful → ${newState.url} "${newState.title}"`
            );

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
          } catch (stateError) {
            debugLog(`Page state capture failed after type: ${stateError}`);
            tag('warning').log(
              `⚠️ Type executed but page state capture failed: ${stateError}`
            );
            return {
              success: false,
              action: 'type',
              text,
              locator,
              error: `Failed to capture page state: ${stateError}`,
            };
          }
        } catch (error) {
          debugLog(`Type failed: ${error}`);
          tag('error').log(`❌ Type failed: ${error}`);
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
