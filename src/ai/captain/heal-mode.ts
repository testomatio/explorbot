import { tool } from 'ai';
import dedent from 'dedent';
import { z } from 'zod';
import { Stats } from '../../stats.ts';
import { tag } from '../../utils/logger.js';
import { type Constructor, type ModeContext } from './mixin.ts';
import { type WebModeMethods } from './web-mode.ts';

export function WithHealMode<T extends Constructor<WebModeMethods>>(Base: T) {
  return class extends Base {
    healModeTools(ctx: ModeContext): Record<string, any> {
      const webTools = this.webModeTools(ctx);

      return {
        ...webTools,
        wait: tool({
          description: 'Pause for transient conditions (rate limit, slow backend, blank page that is still loading). Max 120s.',
          inputSchema: z.object({
            seconds: z.number().int().min(5).max(120),
            reason: z.string(),
          }),
          execute: async ({ seconds, reason }) => {
            tag('info').log(`Heal: waiting ${seconds}s — ${reason}`);
            await new Promise((r) => setTimeout(r, seconds * 1000));
            return { waited: seconds, reason };
          },
        }),
        restartBrowser: tool({
          description: 'Full browser restart — stops Playwright, clears recorder state, reconnects. Use when reload/navigate cannot recover (target closed, frame detached, persistent context error).',
          inputSchema: z.object({ reason: z.string() }),
          execute: async ({ reason }) => {
            tag('info').log(`Heal: restartBrowser — ${reason}`);
            await ctx.explorBot.getExplorer().restartBrowser();
            return { restarted: true, reason };
          },
        }),
        halt: tool({
          description: 'Systematic failure — remaining tests cannot succeed (server down, model unavailable, same error repeating across unrelated scenarios). Stops the session; remaining tests are skipped with this reason. Use this aggressively when you see the same root cause repeat.',
          inputSchema: z.object({ reason: z.string() }),
          execute: async ({ reason }) => {
            Stats.haltSession = reason;
            Stats.lastHealReason = reason;
            tag('error').log(`Heal: halt — ${reason}`);
            return { halted: true, reason };
          },
        }),
      };
    }

    healModePrompt(): string {
      return dedent`
        <heal_capabilities>
        You are diagnosing a cluster of failures during a long-running session.
        You have the recent error history, current browser state, and plan progress.

        Recovery escalates from cheap to expensive — try the lighter option first:
        - probe the page with browser(evaluate) or codeceptjs see/context
        - reload via browser(reload)
        - ask Navigator to re-resolve expected state via navigate(destination)
        - restartBrowser as a last resort

        If errors look transient and time-only (rate limit, 429, blank page), pick wait.
        If the same error keeps repeating across unrelated scenarios, pick halt — remaining work will fail the same way.
        End with done(summary).
        </heal_capabilities>
      `;
    }

    healModeRules(): string {
      return dedent`
        - prefer halt when same root cause repeats across 2+ different scenarios
        - prefer restartBrowser when error mentions Target closed / Frame was detached / context closed
        - prefer navigate over browser(reload) when current URL differs from expected — session likely dropped
        - prefer wait only for rate-limit / 429 / blank-page / "navigating and changing" patterns
        - probe BEFORE acting: browser(evaluate, "window.location.href") or see() is cheap and informs the choice
        - call done() once a recovery action has been taken or a halt verdict issued
      `;
    }
  };
}

export interface HealModeMethods {
  healModeTools(ctx: ModeContext): Record<string, any>;
  healModePrompt(): string;
  healModeRules(): string;
}
