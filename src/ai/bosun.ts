import { tool } from 'ai';
import dedent from 'dedent';
import { z } from 'zod';
import { ActionResult } from '../action-result.ts';
import { setActivity } from '../activity.ts';
import type { ExperienceTracker } from '../experience-tracker.ts';
import type Explorer from '../explorer.ts';
import type { KnowledgeTracker } from '../knowledge-tracker.ts';
import { Observability } from '../observability.ts';
import { Plan, Task, Test, TestResult } from '../test-plan.ts';
import { diffAriaSnapshots } from '../utils/aria.ts';
import { HooksRunner } from '../utils/hooks-runner.ts';
import { createDebug, tag } from '../utils/logger.ts';
import { loop, pause } from '../utils/loop.ts';
import type { Agent } from './agent.ts';
import type { Conversation } from './conversation.ts';
import type { Navigator } from './navigator.ts';
import type { Provider } from './provider.ts';
import type { Researcher } from './researcher.ts';
import { locatorRule } from './rules.ts';
import { TaskAgent, isInteractive } from './task-agent.ts';
import { createAgentTools, createCodeceptJSTools } from './tools.ts';

const debugLog = createDebug('explorbot:bosun');

interface ComponentInfo {
  name: string;
  role: string;
  locator: string;
  section?: string;
}

interface InteractionResult {
  component: string;
  action: string;
  result: 'success' | 'failed' | 'unknown';
  description: string;
  code?: string;
}

interface ComponentTest extends Test {
  component?: ComponentInfo;
  interactions?: InteractionResult[];
}

interface DrillOptions {
  knowledgePath?: string;
  maxComponents?: number;
  interactive?: boolean;
}

export class Bosun extends TaskAgent implements Agent {
  protected readonly ACTION_TOOLS = ['click', 'type', 'select', 'pressKey', 'form'];
  emoji = '⚓';
  private explorer: Explorer;
  private provider: Provider;
  private researcher: Researcher;
  private navigator: Navigator;
  private hooksRunner: HooksRunner;
  private currentPlan?: Plan;
  private currentConversation: Conversation | null = null;
  private allResults: InteractionResult[] = [];
  private agentTools: any;

  MAX_ITERATIONS = 50;

  constructor(explorer: Explorer, provider: Provider, researcher: Researcher, navigator: Navigator, agentTools?: any) {
    super();
    this.explorer = explorer;
    this.provider = provider;
    this.researcher = researcher;
    this.navigator = navigator;
    this.hooksRunner = new HooksRunner(explorer, explorer.getConfig());
    this.agentTools = agentTools;
  }

  protected getNavigator(): Navigator {
    return this.navigator;
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

  getSystemMessage(): string {
    const customPrompt = this.provider.getSystemPromptForAgent('bosun');
    return dedent`
    <role>
    You are a senior QA automation engineer focused on learning how to interact with UI components.
    Your goal is to systematically discover all possible interactions with each component and document what works.
    </role>

    <approach>
    1. Review the UI map to understand all available components
    2. Create a plan listing all components to drill using drill_plan tool
    3. For each component, try appropriate interactions using click, type, select tools
    4. Use drill_record to document successful interactions
    5. If an interaction fails multiple times, use drill_ask for help (in interactive mode)
    6. Call drill_finish when all components have been tested
    </approach>

    <rules>
    - Focus on one component at a time
    - Try multiple locator strategies if one fails
    - Document what each interaction does (opens modal, navigates, etc.)
    - Skip decorative or non-interactive elements
    - Restore page state after each interaction (press Escape or navigate back)
    </rules>

    ${locatorRule}

    ${customPrompt || ''}
    `;
  }

  async drill(opts: DrillOptions = {}): Promise<Plan> {
    const { knowledgePath, maxComponents = 20, interactive = isInteractive() } = opts;
    const state = this.explorer.getStateManager().getCurrentState();
    if (!state) throw new Error('No page state available');

    const sessionName = `bosun_${Date.now().toString(36)}`;
    this.allResults = [];

    return Observability.run(`bosun: ${state.url}`, { tags: ['bosun'], sessionId: sessionName }, async () => {
      tag('info').log(`Bosun starting drill on ${state.url}`);
      setActivity(`${this.emoji} Researching page for drilling...`, 'action');

      await this.hooksRunner.runBeforeHook('bosun', state.url);

      const research = await this.researcher.research(state, { screenshot: true, force: true });

      this.currentPlan = new Plan(`Drill: ${state.url}`);
      this.currentPlan.url = state.url;

      const conversation = this.provider.startConversation(this.getSystemMessage(), 'bosun');
      this.currentConversation = conversation;

      const initialPrompt = await this.buildInitialPrompt(state, research, maxComponents);
      conversation.addUserText(initialPrompt);

      const drillTask = new Task(`Drill session: ${state.url}`, state.url);
      const codeceptjsTools = createCodeceptJSTools(this.explorer, drillTask);
      const drillFlowTools = this.createDrillFlowTools(state, interactive);

      const tools = {
        ...codeceptjsTools,
        ...drillFlowTools,
        ...this.agentTools,
      };

      let drillFinished = false;

      await loop(
        async ({ stop, iteration }) => {
          debugLog(`Drill iteration ${iteration}`);
          setActivity(`${this.emoji} Drilling components...`, 'action');

          const currentState = ActionResult.fromState(this.explorer.getStateManager().getCurrentState()!);

          if (iteration > 1) {
            conversation.cleanupTag('page_aria', '...cleaned aria snapshot...', 2);
            const contextUpdate = await this.buildContextUpdate(currentState);
            conversation.addUserText(contextUpdate);
          }

          const result = await this.provider.invokeConversation(conversation, tools, {
            maxToolRoundtrips: 5,
            toolChoice: 'required',
          });

          if (!result) throw new Error('Failed to get response from provider');

          const toolExecutions = result.toolExecutions || [];
          this.trackToolExecutions(toolExecutions);

          for (const execution of toolExecutions) {
            if (execution.wasSuccessful && this.ACTION_TOOLS.includes(execution.toolName)) {
              const componentName = execution.input?.explanation || 'unknown';
              this.allResults.push({
                component: componentName,
                action: execution.toolName,
                result: 'success',
                description: execution.output?.message || 'Action completed',
                code: execution.output?.code,
              });
            }
          }

          const finishExecution = toolExecutions.find((e: any) => e.toolName === 'drill_finish');
          if (finishExecution) {
            drillFinished = true;
            stop();
            return;
          }

          if (iteration >= this.MAX_ITERATIONS) {
            tag('warning').log('Max iterations reached');
            stop();
          }
        },
        {
          maxAttempts: this.MAX_ITERATIONS,
          interruptPrompt: 'Drill interrupted. Enter instruction (or "stop" to end):',
          observability: {
            agent: 'bosun',
            sessionId: sessionName,
          },
          catch: async ({ error, stop }) => {
            tag('error').log(`Drill error: ${error}`);
            stop();
          },
        }
      );

      await this.saveToExperience(state, this.allResults);

      if (knowledgePath) {
        await this.saveToKnowledge(knowledgePath, state, this.allResults);
      }

      await this.hooksRunner.runAfterHook('bosun', state.url);
      this.logSummary();

      return this.currentPlan;
    });
  }

  private async buildInitialPrompt(state: any, research: string, maxComponents: number): Promise<string> {
    const actionResult = ActionResult.fromState(state);
    const knowledge = this.getKnowledge(actionResult);
    const experience = this.getExperience(actionResult);

    return dedent`
      <task>
      Drill all interactive components on this page to learn how to interact with them.
      Maximum components to drill: ${maxComponents}
      </task>

      <page>
      URL: ${state.url}
      Title: ${state.title || 'Unknown'}
      </page>

      <page_ui_map>
      ${research}
      </page_ui_map>

      <page_aria>
      ${state.ariaSnapshot || ''}
      </page_aria>

      ${knowledge}
      ${experience}

      <instructions>
      1. First, call drill_plan to create a list of components to test
      2. Then systematically test each component using click, type, or select tools
      3. Use drill_record to save observations about what each component does
      4. Press Escape or use drill_restore to reset state between tests
      5. Call drill_finish when all components have been tested
      </instructions>
    `;
  }

  private async buildContextUpdate(currentState: ActionResult): Promise<string> {
    const remainingComponents = this.currentPlan?.tests.filter((t) => !t.hasFinished).length || 0;

    return dedent`
      <context_update>
      Current URL: ${currentState.url}
      Components remaining: ${remainingComponents}
      Successful interactions so far: ${this.allResults.filter((r) => r.result === 'success').length}
      </context_update>

      <page_aria>
      ${currentState.ariaSnapshot || ''}
      </page_aria>

      Continue drilling components. Test each one and record what it does.
    `;
  }

  private createDrillFlowTools(originalState: any, interactive: boolean) {
    const originalUrl = originalState.url;

    return {
      drill_plan: tool({
        description: 'Create a plan of components to drill. Call this first to identify all testable components from the UI map.',
        inputSchema: z.object({
          components: z.array(
            z.object({
              name: z.string().describe('Display name of the component'),
              role: z.string().describe('ARIA role (button, link, textbox, combobox, etc.)'),
              locator: z.string().describe('Best locator for this component'),
              section: z.string().optional().describe('Section of the page where component is located'),
            })
          ),
        }),
        execute: async ({ components }) => {
          for (const comp of components) {
            const task = new Test(`Learn: ${comp.name} (${comp.role})`, 'medium', [`Discover interactions for ${comp.name}`], originalUrl) as ComponentTest;
            task.component = comp;
            task.interactions = [];
            this.currentPlan!.addTest(task);
          }

          tag('info').log(`Created drill plan with ${components.length} components`);

          return {
            success: true,
            message: `Plan created with ${components.length} components`,
            components: components.map((c) => `${c.name} (${c.role})`),
            instruction: 'Now test each component using click, type, or select tools. Record observations with drill_record.',
          };
        },
      }),

      drill_record: tool({
        description: 'Record what a component does after testing it. Call this after each successful interaction.',
        inputSchema: z.object({
          component: z.string().describe('Component name that was tested'),
          action: z.string().describe('Action performed (click, type, select)'),
          result: z.string().describe('What happened (opened modal, navigated to X, showed dropdown, etc.)'),
          code: z.string().optional().describe('The CodeceptJS code that worked'),
        }),
        execute: async ({ component, action, result, code }) => {
          const task = this.findComponentTask(component);
          if (task) {
            task.addNote(`${action}: ${result}`, TestResult.PASSED);
            task.finish(TestResult.PASSED);
          }

          this.allResults.push({
            component,
            action,
            result: 'success',
            description: result,
            code,
          });

          tag('success').log(`${component}: ${action} -> ${result}`);

          return {
            success: true,
            recorded: `${component}: ${action} -> ${result}`,
            instruction: 'Continue testing other components or call drill_finish when done.',
          };
        },
      }),

      drill_restore: tool({
        description: 'Restore page state after testing a component. Use when page navigated away or modal opened.',
        inputSchema: z.object({
          reason: z.string().describe('Why restoration is needed'),
        }),
        execute: async ({ reason }) => {
          const currentState = this.explorer.getStateManager().getCurrentState();
          const action = this.explorer.createAction();

          if (currentState?.url !== originalUrl) {
            await action.execute(`I.amOnPage("${originalUrl}")`);
            return { success: true, action: 'navigated back', url: originalUrl };
          }

          await action.execute('I.pressKey("Escape")');
          return { success: true, action: 'pressed Escape' };
        },
      }),

      drill_skip: tool({
        description: 'Skip a component that cannot be drilled.',
        inputSchema: z.object({
          component: z.string().describe('Component to skip'),
          reason: z.string().describe('Why this component is being skipped'),
        }),
        execute: async ({ component, reason }) => {
          const task = this.findComponentTask(component);
          if (task) {
            task.addNote(`Skipped: ${reason}`, TestResult.FAILED);
            task.finish(TestResult.FAILED);
          }

          this.allResults.push({
            component,
            action: 'skip',
            result: 'unknown',
            description: reason,
          });

          tag('warning').log(`Skipped ${component}: ${reason}`);
          return { success: true, skipped: component, reason };
        },
      }),

      drill_ask: tool({
        description: 'Ask the user for help when stuck on a component. Only available in interactive mode.',
        inputSchema: z.object({
          component: z.string().describe('Component you need help with'),
          question: z.string().describe('What you need help with'),
          triedLocators: z.array(z.string()).optional().describe('Locators already tried'),
        }),
        execute: async ({ component, question, triedLocators }) => {
          if (!interactive) {
            return { success: false, message: 'Not in interactive mode. Skip this component.' };
          }

          let prompt = `Help needed for "${component}"\n${question}`;
          if (triedLocators?.length) {
            prompt += `\n\nAlready tried:\n${triedLocators.map((l) => `  - ${l}`).join('\n')}`;
          }
          prompt += '\n\nYour CodeceptJS command ("skip" to continue):';

          const userInput = await pause(prompt);

          if (!userInput || userInput.toLowerCase() === 'skip') {
            return { success: false, skipped: true, instruction: 'Use drill_skip to skip this component.' };
          }

          return {
            success: true,
            userSuggestion: userInput,
            instruction: `Try this command: ${userInput}`,
          };
        },
      }),

      drill_finish: tool({
        description: 'Finish the drill session. Call when all components have been tested.',
        inputSchema: z.object({
          summary: z.string().describe('Summary of what was learned during drilling'),
        }),
        execute: async ({ summary }) => {
          for (const test of this.currentPlan!.tests) {
            if (!test.hasFinished) {
              test.addNote('Not tested');
              test.finish(TestResult.FAILED);
            }
          }

          tag('info').log(`Drill completed: ${summary}`);

          return {
            success: true,
            totalComponents: this.currentPlan!.tests.length,
            successfulInteractions: this.allResults.filter((r) => r.result === 'success').length,
            summary,
          };
        },
      }),
    };
  }

  private findComponentTask(componentName: string): ComponentTest | undefined {
    return this.currentPlan?.tests.find((t) => {
      const ct = t as ComponentTest;
      return ct.component?.name === componentName || t.scenario.includes(componentName);
    }) as ComponentTest | undefined;
  }

  private async saveToExperience(state: any, results: InteractionResult[]): Promise<void> {
    const experienceTracker = this.getExperienceTracker();
    const actionResult = ActionResult.fromState(state);

    const successfulInteractions = results.filter((r) => r.result === 'success' && r.code);

    for (const interaction of successfulInteractions) {
      await experienceTracker.saveSuccessfulResolution(actionResult, `Drill ${interaction.action}: ${interaction.component}`, interaction.code!, interaction.description);
    }

    if (successfulInteractions.length > 0) {
      tag('success').log(`Saved ${successfulInteractions.length} interactions to experience`);
    }
  }

  private async saveToKnowledge(knowledgePath: string, state: any, results: InteractionResult[]): Promise<void> {
    const knowledgeTracker = this.getKnowledgeTracker();
    const successfulInteractions = results.filter((r) => r.result === 'success');

    if (successfulInteractions.length === 0) {
      tag('warning').log('No successful interactions to save to knowledge');
      return;
    }

    const content = this.generateKnowledgeContent(state, successfulInteractions);
    const result = knowledgeTracker.addKnowledge(knowledgePath, content);

    tag('success').log(`Knowledge saved to: ${result.filePath}`);
  }

  private generateKnowledgeContent(state: any, interactions: InteractionResult[]): string {
    const lines: string[] = [];
    lines.push('# Component Interactions\n');
    lines.push(`Learned interactions from drilling ${state.url}\n`);

    const groupedByComponent = new Map<string, InteractionResult[]>();
    for (const interaction of interactions) {
      const existing = groupedByComponent.get(interaction.component) || [];
      existing.push(interaction);
      groupedByComponent.set(interaction.component, existing);
    }

    for (const [component, items] of groupedByComponent) {
      lines.push(`\n## ${component}\n`);
      for (const item of items) {
        lines.push(`- **${item.action}**: ${item.description}`);
        if (item.code) {
          lines.push('```js');
          lines.push(item.code);
          lines.push('```');
        }
      }
    }

    return lines.join('\n');
  }

  private logSummary(): void {
    if (!this.currentPlan) return;

    const total = this.currentPlan.tests.length;
    const passed = this.currentPlan.tests.filter((t) => t.isSuccessful).length;
    const failed = this.currentPlan.tests.filter((t) => t.hasFailed).length;
    const successfulInteractions = this.allResults.filter((r) => r.result === 'success').length;

    tag('info').log('\nDrill Summary:');
    tag('info').log(`  Total components: ${total}`);
    tag('success').log(`  Successful: ${passed}`);
    if (failed > 0) {
      tag('warning').log(`  Failed: ${failed}`);
    }
    tag('info').log(`  Total interactions learned: ${successfulInteractions}`);

    for (const test of this.currentPlan.tests) {
      const componentTask = test as ComponentTest;
      const status = test.isSuccessful ? '✓' : '✗';
      const successCount = componentTask.interactions?.filter((i) => i.result === 'success').length || 0;
      tag('step').log(`  ${status} ${componentTask.component?.name || test.scenario}: ${successCount} interactions`);
    }
  }

  getCurrentPlan(): Plan | undefined {
    return this.currentPlan;
  }

  getConversation(): Conversation | null {
    return this.currentConversation;
  }
}
