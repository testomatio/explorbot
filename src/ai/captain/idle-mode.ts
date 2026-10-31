import { tool } from 'ai';
import { createBashTool } from 'bash-tool';
import dedent from 'dedent';
import { z } from 'zod';
import { ConfigParser } from '../../config.ts';
import { Plan, Test } from '../../test-plan.ts';
import { getStyles } from '../planner/styles.ts';
import { PlanningBlockedError } from '../../utils/error-page.ts';
import { listRecentArtifacts, readCaptainFile } from './file-tools.ts';
import { type Constructor, type ModeContext, resolveProjectRoot } from './mixin.ts';

let cachedBashTool: Awaited<ReturnType<typeof createBashTool>> | null = null;

export function WithIdleMode<T extends Constructor>(Base: T) {
  return class extends Base {
    async idleModeTools(ctx: ModeContext): Promise<Record<string, any>> {
      const projectRoot = resolveProjectRoot();
      const config = ConfigParser.getInstance().getConfig();
      const knowledgeDir = config.dirs?.knowledge || 'knowledge';
      const experienceDir = config.dirs?.experience || 'experience';
      const outputDir = config.dirs?.output || 'output';
      const readableDirs = [outputDir, knowledgeDir, experienceDir];

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
        plan: tool({
          description: dedent`
            Plan tests for the current page. Adds them to the current plan when it is for this page, otherwise starts a new plan.
            Without tests, the Planner writes the tests. With tests, exactly those tests are added and the Planner does not run: use it for tests the user dictates.
            Returns how many tests were added, or why planning failed.
          `,
          inputSchema: z.object({
            feature: z.string().optional().describe('Focus area for the Planner'),
            style: z
              .enum(Object.keys(getStyles()) as [string, ...string[]])
              .optional()
              .describe('Planning style for the Planner; omit to let it choose'),
            tests: z
              .array(
                z.object({
                  scenario: z.string(),
                  priority: z.enum(['critical', 'important', 'high', 'normal', 'low']).optional(),
                  expected: z.array(z.string()).optional(),
                })
              )
              .optional()
              .describe('Tests to add as written, without running the Planner'),
            replace: z.boolean().optional().describe('Remove the tests already in this page plan first'),
            title: z.string().optional().describe('New plan title'),
          }),
          execute: async ({ feature, style, tests, replace, title }) => {
            if (ctx.blocker instanceof PlanningBlockedError) {
              feature = ctx.blocker.feature;
              style = ctx.blocker.style;
            }
            const url = ctx.explorBot.stateManager().getCurrentState()?.url || '';
            let plan = ctx.explorBot.getCurrentPlan();
            if (plan?.url && plan.url !== url) plan = undefined;
            if (replace) plan?.tests.splice(0);
            const before = new Set(plan?.tests ?? []);
            if (!tests?.length) {
              plan = await ctx.explorBot.plan(feature, { style });
              const error = ctx.explorBot.lastPlanError;
              if (error) return { success: false, message: error.message };
            }
            if (!plan) {
              plan = new Plan(url);
              ctx.explorBot.setCurrentPlan(plan);
            }
            for (const t of tests ?? []) {
              plan.addTest(new Test(t.scenario, t.priority || 'normal', t.expected ?? [], url));
            }
            if (title) plan.title = title;
            plan.updateStatus();
            return { success: true, testsAdded: plan.tests.filter((t) => !before.has(t)).length, tests: plan.tests.length };
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
                suggestion: 'Use readFile to inspect specific reports, plans, logs, generated tests, knowledge, or experience files.',
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
        readFile: tool({
          description: dedent`
            Read a specific Explorbot project file for analysis.
            Use this for explicit user questions about reports, plans, logs, generated tests, knowledge, or experience files.
            Prefer this over bash() for reading file contents after bash has found the file.
          `,
          inputSchema: z.object({
            path: z.string().describe('Path inside output, knowledge, or experience directories'),
            startLine: z.number().optional().describe('First line to read, 1-based. Negative values count from the end of the file'),
            endLine: z.number().optional().describe('Last line to read, 1-based and inclusive. Negative values count from the end of the file'),
            maxChars: z.number().optional().describe('Maximum characters to return, default 12000'),
          }),
          execute: async (input) => readCaptainFile(projectRoot, input, readableDirs),
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
      const outputDir = config.dirs?.output || 'output';

      return dedent`
        <idle_capabilities>
        - Plan management: plan() — run the Planner on the current page, or add tests you write yourself
        - readFile() — read specific report, plan, log, generated test, knowledge, or experience file content
        - bash() — discover files and inspect file metadata
          - READ from: ${knowledgeDir}/, ${experienceDir}/, ${outputDir}/
          - WRITE to: ${knowledgeDir}/, ${experienceDir}/ only (NOT ${outputDir}/)
          - Use wc -l -c file.txt to inspect size
          - Use file file.txt to inspect type
          - Use find . -name "*.md" to discover files
          - Use grep -n "keyword" file.txt to find matching lines
          - Use ls -lh to list files
        </idle_capabilities>

        <file_reading>
        Use bash() for file discovery and search. Once the needed file and line range are known,
        use readFile() to read its contents. Do not use bash() to print file contents.
        </file_reading>

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

export interface IdleModeMethods {
  idleModeTools(ctx: ModeContext): Promise<Record<string, any>>;
  idleModePrompt(): string;
}
