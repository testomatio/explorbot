import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { tool } from 'ai';
import dedent from 'dedent';
import { z } from 'zod';
import { ConfigParser } from '../config.ts';
import type { ExplorBot } from '../explorbot.ts';
import { truncateJson } from '../utils/strings.ts';
import { Researcher } from './researcher.ts';

export function createCaptainTools(ctx: { explorBot: ExplorBot; commandExecutor: ((cmd: string) => Promise<void>) | null }) {
  return {
    runCommand: tool({
      description: dedent`
        Execute a TUI command. Available commands:
        /research [uri] — research current or specified page (--deep for extended)
        /plan [feature] — generate test plan (--fresh to regenerate)
        /test [session|*] — run next test, specific test, or all tests
        /navigate <uri> — navigate to a page
        /explore — full cycle: research → plan → test
        /freesail — autonomous continuous exploration (--deep, --shallow, --scope)
        /drill [--max N] — drill page components
        /knows — list knowledge files
        /knows:add — add knowledge for current page
        /context — page context summary (--visual, --full)
        /context:aria — ARIA snapshot
        /context:html — HTML snapshot
        /context:knowledge — relevant knowledge
        /context:experience — relevant experience
        /plan:save [file] — save plan to file
        /plan:load <file> — load plan from file
        /plan:reload [feature] — regenerate plan
        /plan:clear — clear current plan
        /path — navigation history (--links for outgoing)
        /status — session stats & token usage
        /clean — clean artifacts (--type all|experience)
      `,
      inputSchema: z.object({
        command: z.string().describe('Slash command to execute, e.g. "/research", "/plan authentication", "/test brave-fox123"'),
      }),
      execute: async ({ command }) => {
        if (!ctx.commandExecutor) return { success: false, message: 'Command executor not available' };
        const cmd = command.startsWith('/') ? command : `/${command}`;
        await ctx.commandExecutor(cmd);
        return { success: true, message: `Executed: ${cmd}` };
      },
    }),

    test: tool({
      description: dedent`
        Inspect test execution data. Use flags to control output depth.
        Tests are identified by sessionName (e.g. "brave-fox123").

        Examples:
          test()                              — summary of all tests in plan (with sessionNames)
          test --session brave-fox123         — details: notes, expected, result
          test --session brave-fox123 --log   — full chronological execution log
          test --session brave-fox123 --tools — tool executions with ariaChanges
          test --session brave-fox123 --tools --last 5 — last 5 tool calls only
          test --session brave-fox123 --states — visited pages (URL, title, headings)
          test --session brave-fox123 --aria 2 — ARIA snapshot of visited state #2
          test --session brave-fox123 --code  — generated CodeceptJS code
          test --session brave-fox123 --pilot — Pilot's last analysis
      `,
      inputSchema: z.object({
        session: z.string().optional().describe('Test sessionName (e.g. "brave-fox123"). Omit for plan summary.'),
        log: z.boolean().optional().describe('Include full execution log'),
        tools: z.boolean().optional().describe('Include tool executions with pageDiff'),
        last: z.number().optional().describe('Limit tool executions to last N'),
        states: z.boolean().optional().describe('Include visited page states'),
        aria: z.number().optional().describe('Return ARIA snapshot of visited state at index N'),
        code: z.boolean().optional().describe('Include generated CodeceptJS code'),
        pilot: z.boolean().optional().describe('Include Pilot analysis'),
      }),
      execute: async ({ session, log, tools, last, states, aria, code, pilot }) => {
        const plan = ctx.explorBot.getCurrentPlan();
        if (!plan || plan.tests.length === 0) return { success: false, message: 'No plan or tests available' };

        if (!session) {
          return {
            success: true,
            planTitle: plan.title,
            tests: plan.tests.map((t) => ({
              session: t.sessionName,
              scenario: t.scenario,
              status: t.status,
              result: t.result,
              priority: t.priority,
            })),
          };
        }

        const t = plan.tests.find((test) => test.sessionName === session);
        if (!t) return { success: false, message: `Test "${session}" not found` };

        const result: Record<string, any> = {
          success: true,
          session: t.sessionName,
          scenario: t.scenario,
          status: t.status,
          result: t.result,
          priority: t.priority,
          startUrl: t.startUrl,
          expected: t.expected,
          notes: t.notesToString(),
        };

        if (log) result.log = t.getLogString();

        if (tools) {
          const testerConv = ctx.explorBot.agentTester().getConversation();
          if (testerConv) {
            let execs = testerConv.getToolExecutions();
            if (last) execs = execs.slice(-last);
            result.toolExecutions = execs.map((e) => ({
              tool: e.toolName,
              success: e.wasSuccessful,
              input: e.input?.explanation || e.input?.assertion || truncateJson(e.input),
              ariaChanges: e.output?.pageDiff?.ariaChanges || null,
              url: e.output?.pageDiff?.currentUrl || null,
              error: e.wasSuccessful ? null : e.output?.message || null,
            }));
          }
        }

        if (states) {
          result.visitedStates = t.states.map((s, i) => ({
            index: i,
            url: s.url,
            title: s.title,
            h1: s.h1,
            h2: s.h2,
          }));
        }

        if (aria !== undefined && t.states[aria]) {
          result.ariaSnapshot = t.states[aria].ariaSnapshot;
        }

        if (code) result.generatedCode = t.generatedCode || 'Not generated yet';

        if (pilot) {
          result.pilotAnalysis = ctx.explorBot.agentPilot().getLastAnalysis() || 'No analysis available';
        }

        return result;
      },
    }),

    getResearch: tool({
      description: 'Get the latest cached research report for the current page. Returns UI map with interactive elements. No AI cost.',
      inputSchema: z.object({}),
      execute: async () => {
        const state = ctx.explorBot.getExplorer().getStateManager().getCurrentState();
        if (!state) return { success: false, message: 'No page loaded' };
        const cached = Researcher.getCachedResearch(state);
        if (cached) return { success: true, research: cached };
        return { success: false, message: 'No cached research. Use runCommand("/research") to generate.' };
      },
    }),

    getSessionLog: tool({
      description: 'Get recent session log entries. Shows timestamped actions, errors, and events.',
      inputSchema: z.object({
        lines: z.number().optional().describe('Number of recent lines to return. Default 50.'),
      }),
      execute: async ({ lines }) => {
        const limit = lines ?? 50;
        const outputDir = ConfigParser.getInstance().getOutputDir();
        const logPath = join(outputDir, 'explorbot.log');
        if (!existsSync(logPath)) return { success: false, message: 'No session log found' };
        const content = readFileSync(logPath, 'utf8');
        const allLines = content.split('\n');
        return { success: true, log: allLines.slice(-limit).join('\n'), totalLines: allLines.length };
      },
    }),

    readFile: tool({
      description: 'Read a file from knowledge, experience, or output directories. Returns content truncated to maxLines.',
      inputSchema: z.object({
        path: z.string().describe('Relative path like "knowledge/login.md" or "output/research/abc.md"'),
        maxLines: z.number().optional().describe('Maximum lines to return. Default 100.'),
      }),
      execute: async ({ path: filePath, maxLines }) => {
        const limit = maxLines ?? 100;
        const projectRoot = resolveProjectRoot();
        if (!projectRoot) return { success: false, message: 'Config path not found' };

        const config = ConfigParser.getInstance().getConfig();
        const knowledgeDir = config.dirs?.knowledge || 'knowledge';
        const experienceDir = config.dirs?.experience || 'experience';
        const allowedPrefixes = [knowledgeDir, experienceDir, 'output'];

        if (!allowedPrefixes.some((p) => filePath.startsWith(p))) {
          return { success: false, message: 'Access restricted to knowledge/, experience/, output/ directories' };
        }

        const fullPath = join(projectRoot, filePath);
        if (!existsSync(fullPath)) return { success: false, message: `File not found: ${filePath}` };

        const content = readFileSync(fullPath, 'utf8');
        const lines = content.split('\n');
        return {
          success: true,
          content: lines.slice(0, limit).join('\n'),
          totalLines: lines.length,
          truncated: lines.length > limit,
        };
      },
    }),

    writeFile: tool({
      description: 'Write a file to knowledge or experience directories.',
      inputSchema: z.object({
        path: z.string().describe('Relative path like "knowledge/login.md" or "experience/notes.md"'),
        content: z.string().describe('File content to write'),
      }),
      execute: async ({ path: filePath, content }) => {
        const projectRoot = resolveProjectRoot();
        if (!projectRoot) return { success: false, message: 'Config path not found' };

        const config = ConfigParser.getInstance().getConfig();
        const knowledgeDir = config.dirs?.knowledge || 'knowledge';
        const experienceDir = config.dirs?.experience || 'experience';

        if (!filePath.startsWith(knowledgeDir) && !filePath.startsWith(experienceDir)) {
          return { success: false, message: 'Write access restricted to knowledge/ and experience/ directories' };
        }

        const fullPath = join(projectRoot, filePath);
        mkdirSync(dirname(fullPath), { recursive: true });
        writeFileSync(fullPath, content, 'utf8');
        return { success: true, message: `Written: ${filePath}` };
      },
    }),

    listFiles: tool({
      description: 'List files in knowledge, experience, or output directories.',
      inputSchema: z.object({
        directory: z.enum(['knowledge', 'experience', 'output']).describe('Which directory to list'),
        subdirectory: z.string().optional().describe('Optional subdirectory'),
      }),
      execute: async ({ directory, subdirectory }) => {
        const projectRoot = resolveProjectRoot();
        if (!projectRoot) return { success: false, message: 'Config path not found' };

        const config = ConfigParser.getInstance().getConfig();
        let dirPath: string;
        if (directory === 'output') {
          dirPath = ConfigParser.getInstance().getOutputDir();
        } else if (directory === 'knowledge') {
          dirPath = join(projectRoot, config.dirs?.knowledge || 'knowledge');
        } else {
          dirPath = join(projectRoot, config.dirs?.experience || 'experience');
        }

        if (subdirectory) dirPath = join(dirPath, subdirectory);
        if (!existsSync(dirPath)) return { success: true, files: [] };

        const files = readdirSync(dirPath).map((f) => {
          const stat = statSync(join(dirPath, f));
          return { name: f, isDirectory: stat.isDirectory(), size: stat.size };
        });
        return { success: true, directory: relative(projectRoot, dirPath), files };
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
        - goto: Navigate to a URL
      `,
      inputSchema: z.object({
        action: z.enum(['evaluate', 'closeTabs', 'screenshot', 'reload', 'goto']).describe('Browser action to perform'),
        code: z.string().optional().describe('JavaScript code for evaluate action'),
        url: z.string().optional().describe('URL for goto action'),
      }),
      execute: async ({ action, code, url }) => {
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
          const context = page.context();
          const pages = context.pages();
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

        if (action === 'goto') {
          if (!url) return { success: false, message: 'URL required for goto action' };
          await page.goto(url);
          return { success: true, message: `Navigated to ${url}` };
        }

        return { success: false, message: `Unknown action: ${action}` };
      },
    }),
  };
}

function resolveProjectRoot(): string | null {
  const configPath = ConfigParser.getInstance().getConfigPath();
  if (!configPath) return null;
  return dirname(configPath);
}
