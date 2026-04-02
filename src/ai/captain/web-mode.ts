import { tool } from 'ai';
import dedent from 'dedent';
import { z } from 'zod';
import { actionRule, locatorRule, sectionContextRule } from '../rules.ts';
import { createAgentTools, createCodeceptJSTools } from '../tools.ts';
import { type Constructor, type ModeContext, debugLog } from './mixin.ts';

export function WithWebMode<T extends Constructor>(Base: T) {
  return class extends Base {
    webModeTools(ctx: ModeContext): Record<string, any> {
      const explorer = ctx.explorBot.getExplorer();
      const codeceptTools = createCodeceptJSTools(explorer, ctx.task);
      const agentTools = createAgentTools({
        explorer,
        researcher: ctx.explorBot.agentResearcher(),
        navigator: ctx.explorBot.agentNavigator(),
      });
      const { see, context, visualClick } = agentTools;

      return {
        navigate: tool({
          description: 'Navigate to a URL or page description using AI-powered navigation.',
          inputSchema: z.object({
            destination: z.string().describe('URL path or page description, e.g. "/login", "go to user settings"'),
          }),
          execute: async ({ destination }) => {
            try {
              debugLog('navigate', destination);
              await ctx.explorBot.agentNavigator().visit(destination);
              const stateManager = ctx.explorBot.getExplorer().getStateManager();
              const state = stateManager.getCurrentState();
              return { success: true, url: state?.url, title: state?.title };
            } catch (error: any) {
              return { success: false, message: `Navigation failed: ${error.message}` };
            }
          },
        }),

        browser: tool({
          description: dedent`
            Direct browser access via Playwright. Use for diagnostics and browser management.
            Actions:
            - evaluate: Run JavaScript in browser context (localStorage, cookies, DOM, console)
            - closeTabs: Close all browser tabs except the current one
            - screenshot: Take a screenshot of current page
            - reload: Reload the current page
          `,
          inputSchema: z.object({
            action: z.enum(['evaluate', 'closeTabs', 'screenshot', 'reload']).describe('Browser action to perform'),
            code: z.string().optional().describe('JavaScript code for evaluate action'),
          }),
          execute: async ({ action, code }) => {
            const page = ctx.explorBot.getExplorer().playwrightHelper?.page;
            if (!page) return { success: false, message: 'No browser page available' };

            if (action === 'evaluate') {
              if (!code) return { success: false, message: 'Code required for evaluate action' };
              try {
                const result = await page.evaluate(code);
                const serialized = typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result ?? '');
                return { success: true, result: serialized.length > 2000 ? `${serialized.slice(0, 2000)}\n...truncated` : serialized };
              } catch (error: any) {
                return { success: false, message: `Evaluate failed: ${error.message}` };
              }
            }

            if (action === 'closeTabs') {
              const browserContext = page.context();
              const pages = browserContext.pages();
              let closed = 0;
              for (const p of pages) {
                if (p !== page) {
                  await p.close();
                  closed++;
                }
              }
              return { success: true, message: `Closed ${closed} tab(s), ${pages.length - closed} remaining` };
            }

            if (action === 'screenshot') {
              const buffer = await page.screenshot({ type: 'png' });
              const base64 = buffer.toString('base64');
              return { success: true, screenshot: base64.length > 5000 ? `${base64.slice(0, 5000)}...truncated` : base64 };
            }

            if (action === 'reload') {
              await page.reload();
              return { success: true, message: 'Page reloaded' };
            }

            return { success: false, message: `Unknown action: ${action}` };
          },
        }),

        ...codeceptTools,
        see,
        context,
        visualClick,
      };
    }

    webModePrompt(): string {
      return dedent`
        <web_capabilities>
        - Page actions: click, pressKey, form (CodeceptJS tools)
        - Navigation: navigate() — AI-powered navigation to URLs or page descriptions
        - Browser diagnostics: browser() — evaluate JS, close tabs, screenshot, reload
        - Visual analysis: see() — screenshot-based page verification
        - Context refresh: context() — get fresh HTML/ARIA snapshot
        - Visual fallback: visualClick() — coordinate-based click when locators fail
        </web_capabilities>

        ${locatorRule}

        ${actionRule}

        ${sectionContextRule}
      `;
    }

    webModeRules(): string {
      return dedent`
        - Follow <locator_priority> rules when selecting locators for all tools
        - click() accepts array of commands to try in order — include ARIA, CSS, XPath variants
        - If click() fails with all provided commands, use visualClick() tool as fallback
        - When an action fails or result is unexpected, investigate or inform the user instead of retrying silently
      `;
    }
  };
}

export interface WebModeMethods {
  webModeTools(ctx: ModeContext): Record<string, any>;
  webModePrompt(): string;
  webModeRules(): string;
}
