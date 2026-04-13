import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { tool } from 'ai';
import { createBashTool } from 'bash-tool';
import chalk from 'chalk';
import { highlight } from 'cli-highlight';
import * as codeceptjs from 'codeceptjs';
import heal from 'codeceptjs/lib/heal';
import aiTracePlugin from 'codeceptjs/lib/plugin/aiTrace';
import figureSet from 'figures';
import dedent from 'dedent';
import { z } from 'zod';
import { ActionResult } from '../action-result.ts';
import { setActivity } from '../activity.ts';
import type { ExperienceTracker } from '../experience-tracker.ts';
import type Explorer from '../explorer.ts';
import type { KnowledgeTracker } from '../knowledge-tracker.ts';
import { Stats } from '../stats.ts';
import { Task, Test, TestResult } from '../test-plan.ts';
import { createDebug, tag } from '../utils/logger.ts';
import { loop } from '../utils/loop.ts';
import { loadTestSuites, printTestList } from '../utils/test-files.ts';
import type { Agent } from './agent.ts';
import { toolExecutionLabel } from './conversation.ts';
import type { Navigator } from './navigator.ts';
import { Provider } from './provider.ts';
import { locatorRule, actionRule, sectionContextRule } from './rules.ts';
import { TaskAgent } from './task-agent.ts';
import { RulesLoader } from '../utils/rules-loader.ts';
import { createCodeceptJSTools } from './tools.ts';

const debugLog = createDebug('explorbot:rerunner');

export class Rerunner extends TaskAgent implements Agent {
  protected readonly ACTION_TOOLS = ['click', 'pressKey', 'form'];
  emoji = '🔄';

  private explorer: Explorer;
  private provider: Provider;
  private agentTools: any;
  private healedSteps: Array<{ test: string; original: string; healed: string }> = [];
  private traceDir = '';

  constructor(explorer: Explorer, provider: Provider, agentTools?: any) {
    super();
    this.explorer = explorer;
    this.provider = provider;
    this.agentTools = agentTools;
  }

  protected getNavigator(): Navigator {
    throw new Error('Rerunner does not use Navigator');
  }

  protected getExperienceTracker(): ExperienceTracker {
    return this.explorer.getStateManager().getExperienceTracker();
  }

  protected getKnowledgeTracker(): KnowledgeTracker {
    return this.explorer.getKnowledgeTracker();
  }

  protected getProvider(): Provider {
    return this.provider;
  }

  private get rerunnerConfig(): Record<string, any> {
    return (this.explorer.getConfig().ai?.agents?.rerunner as any) || {};
  }

  private get healLimit(): number {
    return this.rerunnerConfig.healLimit ?? 3;
  }

  private get healMaxIterations(): number {
    return this.rerunnerConfig.healMaxIterations ?? 3;
  }

  listTests(testsDir: string): void {
    printTestList(loadTestSuites(testsDir));
  }

  async rerun(filePath: string, options?: { testIndices?: number[] }): Promise<RerunResult> {
    const absPath = resolve(filePath);
    if (!existsSync(absPath)) {
      tag('error').log(`Test file not found: ${absPath}`);
      return { total: 0, passed: 0, failed: 0, healed: 0 };
    }

    tag('info').log(`Re-running tests from: ${relative(process.cwd(), absPath)}`);
    setActivity('🔄 Re-running tests...', 'action');

    this.healedSteps = [];
    this.setupPlugins();

    const testMap = new Map<string, Test>();
    const results: { test: Test; mochaState: string }[] = [];

    const onTestBefore = (mochaTest: any) => {
      if (!mochaTest.file) mochaTest.file = absPath;
      const task = new Test(mochaTest.title, 'normal', [], '');
      task.start();
      testMap.set(mochaTest.id || mochaTest.title, task);
      Stats.tests++;
      console.log(`\n  ${chalk.green(figureSet.pointer)} ${chalk.bold(mochaTest.title)}`);
    };

    const onStepStarted = (step: any) => {
      if (!step.toCode) return;
      const code = highlight(step.toCode(), { language: 'javascript' });
      console.log(chalk.dim(`    ${code}`));
    };

    const onStepPassed = (step: any) => {
      const task = this.getCurrentTask(testMap);
      if (!task || !step.toCode) return;
      task.addStep(step.toCode(), step.duration, 'passed');
    };

    const onStepFailed = (step: any, error: any) => {
      const task = this.getCurrentTask(testMap);
      if (!task || !step.toCode) return;
      task.addStep(step.toCode(), step.duration, 'failed', error?.message);
      console.log(chalk.red(`    ${figureSet.cross} ${step.toCode()} — ${error?.message || 'failed'}`));
    };

    const onTestPassed = (mochaTest: any) => {
      const task = testMap.get(mochaTest.id || mochaTest.title);
      if (!task) return;
      task.finish(TestResult.PASSED);
      results.push({ test: task, mochaState: 'passed' });
      console.log(chalk.green(`  ${figureSet.tick} passed`));
    };

    const onTestFailed = (mochaTest: any, error: any) => {
      const task = testMap.get(mochaTest.id || mochaTest.title);
      if (!task) return;
      task.addNote(`Failed: ${error?.message || 'unknown error'}`, TestResult.FAILED);
      task.finish(TestResult.FAILED);
      results.push({ test: task, mochaState: 'failed' });
      console.log(chalk.red(`  ${figureSet.cross} failed: ${error?.message || 'unknown'}`));
    };

    const { dispatcher } = codeceptjs.event;
    dispatcher.on('test.before', onTestBefore);
    dispatcher.on('step.start', onStepStarted);
    dispatcher.on('step.passed', onStepPassed);
    dispatcher.on('step.failed', onStepFailed);
    dispatcher.on('test.passed', onTestPassed);
    dispatcher.on('test.failed', onTestFailed);

    try {
      codeceptjs.container.createMocha();
      const mocha = codeceptjs.container.mocha();
      mocha.reporter(class {});
      mocha.files = [absPath];
      mocha.loadFiles();

      let testIndex = 0;
      for (const suite of mocha.suite.suites || []) {
        for (const test of suite.tests || []) {
          if (test.pending) {
            testIndex++;
            continue;
          }
          if (options?.testIndices?.length && !options.testIndices.includes(testIndex)) {
            test.pending = true;
            testIndex++;
            continue;
          }
          if (!hasAssertions(test.body)) {
            test.pending = true;
            tag('substep').log(`Skipping: ${test.title} (no assertions)`);
          }
          testIndex++;
        }
      }

      await new Promise<void>((resolveRun) => {
        mocha.run((failures: number) => {
          debugLog('Mocha run finished with %d failures', failures);
          resolveRun();
        });
      });
    } catch (error) {
      tag('error').log(`Rerun error: ${error instanceof Error ? error.message : error}`);
    } finally {
      dispatcher.off('test.before', onTestBefore);
      dispatcher.off('step.start', onStepStarted);
      dispatcher.off('step.passed', onStepPassed);
      dispatcher.off('step.failed', onStepFailed);
      dispatcher.off('test.passed', onTestPassed);
      dispatcher.off('test.failed', onTestFailed);
      this.teardownHealing();
    }

    if (this.healedSteps.length > 0) {
      this.getHistorian().rewriteScenarioInFile(absPath, this.healedSteps);
      tag('info').log(`Healed ${this.healedSteps.length} step(s), original file updated`);
    }

    const passed = results.filter((r) => r.mochaState === 'passed').length;
    const failed = results.filter((r) => r.mochaState === 'failed').length;
    const result: RerunResult = {
      total: results.length,
      passed,
      failed,
      healed: this.healedSteps.length,
    };

    this.printResults(result);
    return result;
  }

  private getCurrentTask(testMap: Map<string, Test>): Test | undefined {
    const entries = [...testMap.values()];
    return entries[entries.length - 1];
  }

  private setupPlugins(): void {
    const healMod = heal.default || heal;
    healMod.connectToEvents();

    healMod.addRecipe('explorbot-ai-healer', {
      priority: 10,
      fn: async (context: any) => {
        return this.healStep(context.step, context.error);
      },
    });

    const userRecipes = (this.rerunnerConfig.recipes || {}) as Record<string, any>;
    for (const [name, recipe] of Object.entries(userRecipes)) {
      healMod.addRecipe(name, recipe);
    }

    let currentTest: any = null;
    let healTries = 0;
    let isHealing = false;
    let caughtError: any = null;
    const healLimit = this.healLimit;

    codeceptjs.event.dispatcher.on('test.before', (test: any) => {
      currentTest = test;
      healTries = 0;
      caughtError = null;
    });

    codeceptjs.event.dispatcher.on('step.after', (step: any) => {
      if (isHealing) return;
      if (healTries >= healLimit) return;
      if (!healMod.hasCorrespondingRecipes(step)) return;

      codeceptjs.recorder.catchWithoutStop(async (err: any) => {
        isHealing = true;
        if (caughtError === err) throw err;
        caughtError = err;

        codeceptjs.recorder.session.start('heal');
        debugLog('Healing started for: %s', step.toCode());

        await healMod.healStep(step, err, { test: currentTest });

        healTries++;

        codeceptjs.recorder.add('close healing session', () => {
          codeceptjs.recorder.reset();
          codeceptjs.recorder.session.restore('heal');
          codeceptjs.recorder.ignoreErr(err);
        });
        await codeceptjs.recorder.promise();

        isHealing = false;
      });
    });

    (global as any).container = codeceptjs.container;

    codeceptjs.recorder.retry({
      retries: 3,
      when: (err: any) => {
        if (!err?.message) return false;
        return err.message.includes('was not found') || err.message.includes('Timeout') || err.message.includes('exceeded');
      },
      minTimeout: 2000,
      maxTimeout: 5000,
      factor: 1.5,
    });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outputDir = (global as any).output_dir || 'output';
    this.traceDir = `${outputDir}/rerun_${timestamp}`;

    const aiTrace = aiTracePlugin.default || aiTracePlugin;
    aiTrace(this.rerunnerConfig.aiTrace || { output: this.traceDir });
  }

  private teardownHealing(): void {
    const healMod = heal.default || heal;
    healMod.recipes['explorbot-ai-healer'] = undefined;
    for (const name of Object.keys(this.rerunnerConfig.recipes || {})) {
      healMod.recipes[name] = undefined;
    }
  }

  private async healStep(step: any, error: Error): Promise<((deps: { I: any }) => Promise<void>) | null> {
    const failedCode = step.toCode?.() || '';
    console.log(chalk.yellow(`    ${figureSet.arrowRight} Healing: ${failedCode}`));

    return async ({ I }: { I: any }) => {
      const bashTool = await createBashTool({
        destination: this.traceDir,
        onBeforeBashCall: ({ command }) => {
          if (/>[^>]|>>|\btee\b|\brm\b/.test(command)) {
            return { command: 'echo "Read-only" >&2 && exit 1' };
          }
          return { command };
        },
      });

      const healTask = new Task(`Heal: ${failedCode}`);
      const codeceptTools = createCodeceptJSTools(this.explorer, healTask);

      let healed = false;
      let healedCommand = '';

      const tools = {
        bash: bashTool.bash,
        ...codeceptTools,
        ...this.agentTools,
        wait: tool({
          description: 'Wait N seconds for page to load. Use when loading indicators are detected.',
          inputSchema: z.object({
            seconds: z.number().describe('Seconds to wait'),
            note: z.string().optional().describe('What are you waiting for'),
          }),
          execute: async ({ seconds, note }) => {
            if (note) {
              healTask.addNote(note);
              tag('substep').log(note);
            }
            const action = this.explorer.createAction();
            await action.execute(`I.wait(${seconds})`);
            const state = this.explorer.getStateManager().getCurrentState();
            const ar = state ? ActionResult.fromState(state) : null;
            return {
              success: true,
              message: `Waited ${seconds}s`,
              url: state?.url,
              title: state?.title,
              aria: ar?.getInteractiveARIA(),
            };
          },
        }),
        done: tool({
          description: 'Healing succeeded. Report the command that fixed the step.',
          inputSchema: z.object({
            healedCommand: z.string().describe('The CodeceptJS command that fixed the step'),
          }),
          execute: async ({ healedCommand: cmd }) => {
            healed = true;
            healedCommand = cmd;
            return { success: true, healedCommand: cmd };
          },
        }),
        giveUp: tool({
          description: 'Cannot heal. The issue is not fixable (missing data, page fundamentally different).',
          inputSchema: z.object({
            reason: z.string().describe('Why healing is not possible'),
          }),
          execute: async ({ reason }) => {
            console.log(chalk.gray(`    ${figureSet.line} Cannot heal: ${reason}`));
            return { success: false, reason };
          },
        }),
      };

      const conversation = this.provider.startConversation(this.getHealSystemPrompt(), 'rerunner');
      conversation.addUserText(this.getHealUserPrompt(failedCode, error));

      await loop(
        async ({ stop }) => {
          if (healed) {
            stop();
            return;
          }

          const result = await this.provider.invokeConversation(conversation, tools, {
            maxToolRoundtrips: 5,
            toolChoice: 'auto',
          });

          if (!result?.toolExecutions?.length) {
            stop();
            return;
          }

          for (const exec of result.toolExecutions) {
            const icon = exec.wasSuccessful ? chalk.green(figureSet.tick) : chalk.red(figureSet.cross);
            let label = toolExecutionLabel(exec.input) || exec.toolName;
            if (exec.toolName === 'bash') label = `bash: ${(exec.input?.command || '').substring(0, 100)}`;
            tag('substep').log(`${icon} ${label}`);

            if (exec.toolName === 'done') {
              healed = true;
              stop();
              return;
            }
            if (exec.toolName === 'giveUp') {
              stop();
              throw new Error(exec.input?.reason || 'Healing aborted');
            }
          }
        },
        {
          maxAttempts: this.healMaxIterations,
          catch: async ({ error: err, stop }) => {
            if (err.message?.includes('Healing aborted')) throw err;
            tag('warning').log(`Healing error: ${err.message}`);
            stop();
          },
        }
      );

      if (!healed) {
        throw new Error(`Could not heal: ${failedCode}`);
      }

      this.healedSteps.push({ test: '', original: failedCode, healed: healedCommand });
      console.log(chalk.green(`    ${figureSet.tick} Healed: ${healedCommand}`));
    };
  }

  private getHealSystemPrompt(): string {
    const customRules = this.provider.getSystemPromptForAgent('rerunner', this.explorer.getStateManager().getCurrentState()?.url) || '';
    const currentUrl = this.explorer.getStateManager().getCurrentState()?.url || '';
    const approach = RulesLoader.loadRules('rerunner', ['healing-approach'], currentUrl);

    return dedent`
      <role>
      You are a senior test automation engineer healing a failed CodeceptJS test step.
      The failed step did NOT execute. You MUST perform the action it was supposed to do.
      </role>

      ${approach}

      <tools>
      - You MUST execute the replacement action — not just diagnose
      - Use click() for buttons, links — commands array is FALLBACK LOCATORS for the SAME element
      - Use form() for text input, dropdown selection, file uploads
      - Use pressKey() for special keys or key combinations
      - Use wait() when page is loading — returns fresh ARIA automatically
      - Use research() to understand page structure, sections, and available UI elements
      - Use xpathCheck() to search large HTML when element can't be found in ARIA
      - Use see() for visual verification when unsure
      - Use context() to refresh ARIA/HTML after actions
      - Use bash to read trace files (cat */trace.md, grep *_console.json, cat *_aria.txt)
      </tools>

      ${locatorRule}

      ${actionRule}

      ${sectionContextRule}

      ${customRules}
    `;
  }

  private getHealUserPrompt(failedCode: string, error: Error): string {
    const state = this.explorer.getStateManager().getCurrentState();
    const actionResult = state ? ActionResult.fromState(state) : null;

    const headings: string[] = [];
    if (state?.h1) headings.push(`H1: ${state.h1}`);
    if (state?.h2) headings.push(`H2: ${state.h2}`);
    if (state?.h3) headings.push(`H3: ${state.h3}`);
    if (state?.h4) headings.push(`H4: ${state.h4}`);

    return dedent`
      A test step failed and needs healing.

      <failed_step>
      Command: ${failedCode}
      Error: ${error.message}
      </failed_step>

      <page>
      URL: ${state?.url || 'unknown'}
      Title: ${state?.title || 'unknown'}
      ${headings.join('\n')}
      </page>

      <page_aria>
      ${actionResult?.getInteractiveARIA() || 'No ARIA available'}
      </page_aria>

      Trace directory: ${this.traceDir}

      Diagnose and fix the failed step. You MUST execute the replacement action.
    `;
  }

  private printResults(result: RerunResult): void {
    const parts = [];
    if (result.passed > 0) parts.push(`${result.passed} passed`);
    if (result.failed > 0) parts.push(`${result.failed} failed`);
    if (result.healed > 0) parts.push(`${result.healed} healed`);
    console.log(`\n${chalk.bold(`${result.total}`)} tests — ${parts.join(', ')}`);
    if (this.traceDir) {
      console.log(chalk.gray(`Traces: ${this.traceDir}`));
    }
  }
}

function hasAssertions(body: string | undefined): boolean {
  if (!body) return false;
  return /I\.(see|dontSee|seeElement|dontSeeElement|seeInField|seeInSource|dontSeeInSource)\b/.test(body);
}

interface RerunResult {
  total: number;
  passed: number;
  failed: number;
  healed: number;
}
