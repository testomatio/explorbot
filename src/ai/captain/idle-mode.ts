import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { tool } from 'ai';
import { createBashTool } from 'bash-tool';
import dedent from 'dedent';
import { z } from 'zod';
import { ConfigParser } from '../../config.ts';
import { Test } from '../../test-plan.ts';
import { type Constructor, type ModeContext, resolveProjectRoot } from './mixin.ts';

let cachedBashTool: Awaited<ReturnType<typeof createBashTool>> | null = null;

export function WithIdleMode<T extends Constructor>(Base: T) {
  return class extends Base {
    async idleModeTools(ctx: ModeContext): Promise<Record<string, any>> {
      const projectRoot = resolveProjectRoot();
      const config = ConfigParser.getInstance().getConfig();
      const knowledgeDir = config.dirs?.knowledge || 'knowledge';
      const experienceDir = config.dirs?.experience || 'experience';

      if (!cachedBashTool && projectRoot) {
        cachedBashTool = await createBashTool({
          destination: projectRoot,
          onBeforeBashCall: ({ command }) => {
            if (/\b(sudo|chmod|chown)\b/.test(command)) {
              return { command: 'echo "Command not allowed" >&2 && exit 1' };
            }
            const writePatterns = [/>[^>]/, />>/, /\btee\b/, /\bmv\b/, /\bcp\b/, /\brm\b/];
            if (writePatterns.some((p) => p.test(command)) && /\boutput[/\\]/.test(command)) {
              return { command: 'echo "Write access to output/ is restricted" >&2 && exit 1' };
            }
            return { command };
          },
        });
      }

      const tools: Record<string, any> = {
        updatePlan: tool({
          description: 'Update the current plan by replacing or appending tests',
          inputSchema: z.object({
            action: z.enum(['replace', 'append']).optional().describe('replace clears existing tests, append keeps them'),
            title: z.string().optional().describe('New plan title'),
            tests: z
              .array(
                z.object({
                  scenario: z.string(),
                  priority: z.enum(['critical', 'important', 'high', 'normal', 'low']).optional(),
                  expected: z.array(z.string()).optional(),
                })
              )
              .optional(),
          }),
          execute: async ({ action, title, tests }) => {
            let plan = ctx.explorBot.getCurrentPlan();
            if (!plan) {
              plan = await ctx.explorBot.plan();
            }
            if (!plan) {
              return { success: false, message: 'Plan unavailable' };
            }
            if (title) {
              plan.title = title;
            }
            if (tests?.length) {
              if (!action || action === 'replace') {
                plan.tests.length = 0;
              }
              const currentUrl = ctx.explorBot.getExplorer().getStateManager().getCurrentState()?.url || '';
              for (const testInput of tests) {
                const priority = testInput.priority || 'normal';
                const expected = testInput.expected?.length ? testInput.expected : [];
                const test = new Test(testInput.scenario, priority, expected, currentUrl);
                plan.addTest(test);
              }
            }
            plan.updateStatus();
            return { success: true, tests: plan.tests.length };
          },
        }),
        project: tool({
          description: dedent`
            Inspect Explorbot project configuration and recent generated artifacts.
            Use this before answering questions about setup, previous sessions, reports, saved plans, or output files.
          `,
          inputSchema: z.object({
            view: z.enum(['config', 'artifacts']).optional().describe('config shows setup summary; artifacts lists recent generated files'),
          }),
          execute: async ({ view }) => {
            const parser = ConfigParser.getInstance();
            const config = parser.getConfig();
            const outputDir = parser.getOutputDir();

            if (view === 'artifacts') {
              return {
                success: true,
                outputDir,
                artifacts: listRecentArtifacts(outputDir),
                suggestion: 'Use bash to read a specific small report, plan, or log file when needed.',
              };
            }

            return {
              success: true,
              configPath: parser.getConfigPath(),
              baseUrl: config.playwright?.url,
              browser: config.playwright?.browser,
              headed: config.playwright?.show === true,
              dirs: config.dirs,
              agents: Object.fromEntries(Object.entries(config.ai?.agents || {}).map(([name, agentConfig]: [string, any]) => [name, { enabled: agentConfig?.enabled !== false, hasModelOverride: !!agentConfig?.model }])),
              reporterEnabled: config.reporter?.enabled === true,
              apiEnabled: !!config.api,
            };
          },
        }),
        readArtifact: tool({
          description: dedent`
            Read a specific small Explorbot artifact file for analysis.
            Use this for explicit user questions about reports, plans, logs, generated tests, knowledge, or experience files.
            Prefer this over runCommand() for file analysis.
          `,
          inputSchema: z.object({
            path: z.string().describe('Artifact path, such as output/reports/session-name-tests.md or explorbot-testing/output/reports/session-name-tests.md'),
            maxChars: z.number().optional().describe('Maximum characters to return, default 12000'),
          }),
          execute: async ({ path, maxChars }) => {
            const resolved = resolveReadableArtifact(projectRoot, path);
            if (!resolved) {
              return { success: false, message: 'File is outside allowed artifact directories' };
            }
            if (!existsSync(resolved)) {
              return { success: false, message: `File not found: ${path}` };
            }
            if (!statSync(resolved).isFile()) {
              return { success: false, message: `Not a file: ${path}` };
            }

            const limit = Math.max(1000, Math.min(maxChars || 12000, 50000));
            const content = readFileSync(resolved, 'utf8');
            return {
              success: true,
              path: relative(projectRoot || process.cwd(), resolved),
              truncated: content.length > limit,
              content: content.slice(0, limit),
            };
          },
        }),
      };

      if (cachedBashTool) {
        tools.bash = cachedBashTool.bash;
      }

      return tools;
    }

    idleModePrompt(): string {
      const config = ConfigParser.getInstance().getConfig();
      const knowledgeDir = config.dirs?.knowledge || 'knowledge';
      const experienceDir = config.dirs?.experience || 'experience';

      return dedent`
        <idle_capabilities>
        - Plan management: updatePlan() — replace or append tests in the current plan
        - readArtifact() — read a specific report, plan, log, generated test, knowledge, or experience file for analysis
        - bash() — run shell commands for file operations
          - READ from: ${knowledgeDir}/, ${experienceDir}/, output/
          - WRITE to: ${knowledgeDir}/, ${experienceDir}/ only (NOT output/)
          - Use ls to list files, cat to read small files
          - Use head/tail for large files to avoid excessive output
          - Use grep to search file contents
        </idle_capabilities>

        <project_inspection>
        Use project({ view: "config" }) before explaining Explorbot setup or suggesting config improvements.
        Use project({ view: "artifacts" }) before answering questions about previous sessions, reports, plans, generated tests, or logs.
        </project_inspection>

        <knowledge_saving>
        When user shares credentials, selectors, or important domain info during conversation,
        suggest saving it to a knowledge file using bash tool.
        Format: YAML frontmatter with url pattern, then content.
        </knowledge_saving>
      `;
    }
  };
}

function listRecentArtifacts(outputDir: string): Array<{ path: string; size: number; modifiedAt: string }> {
  const dirs = ['reports', 'plans', 'tests', 'states'];
  const artifacts: Array<{ path: string; size: number; modifiedAt: string; timestamp: number }> = [];

  for (const dir of dirs) {
    if (artifacts.length >= 200) break;
    const targetDir = join(outputDir, dir);
    if (!existsSync(targetDir)) continue;
    collectArtifacts(outputDir, targetDir, artifacts);
  }

  return artifacts
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 20)
    .map(({ timestamp, ...artifact }) => artifact);
}

function collectArtifacts(outputDir: string, targetDir: string, artifacts: Array<{ path: string; size: number; modifiedAt: string; timestamp: number }>): void {
  for (const entry of readdirSync(targetDir, { withFileTypes: true })) {
    if (artifacts.length >= 200) return;
    const entryPath = join(targetDir, entry.name);
    if (entry.isDirectory()) {
      collectArtifacts(outputDir, entryPath, artifacts);
      continue;
    }

    const stats = statSync(entryPath);
    artifacts.push({
      path: relative(outputDir, entryPath),
      size: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      timestamp: stats.mtimeMs,
    });
  }
}

function resolveReadableArtifact(projectRoot: string | null, requestedPath: string): string | null {
  if (!projectRoot) return null;

  let cleanPath = requestedPath.trim();
  const projectName = basename(projectRoot);
  if (cleanPath.startsWith(`${projectName}/`) || cleanPath.startsWith(`${projectName}\\`)) {
    cleanPath = cleanPath.slice(projectName.length + 1);
  }

  const resolved = isAbsolute(cleanPath) ? resolve(cleanPath) : resolve(projectRoot, cleanPath);
  const allowedRoots = ['output', 'knowledge', 'experience'].map((dir) => resolve(projectRoot, dir));
  for (const root of allowedRoots) {
    const rel = relative(root, resolved);
    if (!rel || (!rel.startsWith('..') && !isAbsolute(rel))) return resolved;
  }

  return null;
}

export interface IdleModeMethods {
  idleModeTools(ctx: ModeContext): Promise<Record<string, any>>;
  idleModePrompt(): string;
}
