import { tool } from 'ai';
import dedent from 'dedent';
import { z } from 'zod';
import { ActionResult } from '../action-result.js';
import { createDebug, tag } from '../utils/logger.js';

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

        try {
          await actor.click(locator);

          // Capture new page state after click
          let pageState = null;
          try {
            pageState = await capturePageState(actor);
            tag('success').log(`✅ Click successful → ${pageState.url} "${pageState.title}"`);
          } catch (stateError) {
            debugLog(`Page state capture failed after click: ${stateError}`);
            tag('warning').log(`⚠️ Click executed but page state capture failed: ${stateError}`);
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
      description: 'Send keyboard input to the active element or fill a field. After typing, the page state will be automatically captured and returned.',
      inputSchema: z.object({
        text: z.string().describe('The text to type'),
        locator: z.string().optional().describe('Optional CSS or XPath locator to focus on before typing'),
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
            tag('success').log(`✅ Type successful → ${newState.url} "${newState.title}"`);

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
            tag('warning').log(`⚠️ Type executed but page state capture failed: ${stateError}`);
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

    reset: tool({
      description: dedent`
        Reset the testing flow by navigating back to the initial page or context. 
        Use this when the agent has navigated too far from the desired state and 
        there's no clear path to achieve the expected result. This restarts the 
        testing flow from a known good state.
      `,
      inputSchema: z.object({
        reason: z.string().optional().describe('Optional reason for the reset'),
        targetUrl: z.string().optional().describe('Optional specific URL to navigate to for reset'),
      }),
      execute: async ({ reason, targetUrl }) => {
        const reasonMsg = reason ? ` (${reason})` : '';
        tag('substep').log(`🔄 AI Tool: reset()${reasonMsg}`);

        try {
          let resetUrl = targetUrl;

          if (!resetUrl) {
            try {
              resetUrl = await actor.grabCurrentUrl();
              debugLog('No target URL provided, staying on current page');
            } catch (error) {
              debugLog('Could not get current URL, using default reset behavior');
            }
          }

          if (resetUrl) {
            await actor.amOnPage(resetUrl);
            tag('success').log(`✅ Reset successful → navigated to ${resetUrl}`);
          } else {
            tag('warning').log(`⚠️ Reset called but no target URL available`);
          }

          const pageState = await capturePageState(actor);

          return {
            success: true,
            action: 'reset',
            reason,
            targetUrl: resetUrl,
            pageState,
            message: 'Testing flow has been reset to a known state',
          };
        } catch (error) {
          debugLog(`Reset failed: ${error}`);
          tag('error').log(`❌ Reset failed: ${error}`);
          return {
            success: false,
            action: 'reset',
            reason,
            targetUrl,
            error: String(error),
          };
        }
      },
    }),
  };
}
