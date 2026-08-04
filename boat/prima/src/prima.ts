import path from 'node:path';
import dedent from 'dedent';
import { ActionResult } from '../../../src/action-result.ts';
import type { Navigator } from '../../../src/ai/navigator.ts';
import { actionRule, locatorRule } from '../../../src/ai/rules.ts';
import { createCodeceptJSTools } from '../../../src/ai/tools.ts';
import { getAliveEndpoint, launchServer, listInstances, stopServer } from '../../../src/browser-server.ts';
import { ConfigParser, type ExplorbotConfig, outputPath } from '../../../src/config.ts';
import { ExplorBot } from '../../../src/explorbot.ts';
import type { WebPageState } from '../../../src/state-manager.ts';
import { Task } from '../../../src/test-plan.ts';
import { compactAriaSnapshot } from '../../../src/utils/aria.ts';
import { browserErrorMessage } from '../../../src/utils/browser-errors.ts';
import { pluralize } from '../../../src/utils/logger.ts';
import { type EnvelopeData, type HealAttempt, type InstanceInfo, writeArtifacts } from './envelope.ts';
import { isFunctionExpression, toCodeceptWrapper } from './pw-parser.ts';

const MAX_INSTRUCTION_ITERATIONS = 6;
const MAX_TOOL_ROUNDTRIPS = 5;
const AI_AGENT_NAME = 'prima';

export class Prima {
  private options: PrimaOptions;
  private bot: ExplorBot;
  private artifactsDir?: string;
  private server: { close: () => Promise<void> } | null = null;

  constructor(options: PrimaOptions = {}) {
    this.options = options;
    this.bot = new ExplorBot({
      config: options.config,
      path: options.path,
      verbose: options.verbose,
      session: options.session,
      instance: options.instance,
      headless: true,
      optionalAi: true,
    });
  }

  async start(): Promise<void> {
    await this.loadConfig();

    if (!(await this.connectOwnInstance())) {
      throw new Error(dedent`
        No browser session found for instance "${this.instanceName()}".
        Create one first:
          prima browser start   starts a prima-owned browser
        Prima never launches a browser implicitly.
        Attaching to a browser opened by playwright-cli is not wired yet, so --endpoint
        and --pw-session cannot reach one.
      `);
    }

    await this.bot.start();

    if (!this.options.url) return;
    if (this.bot.getCurrentState()) return;
    await this.bot.visit(this.options.url);
  }

  async stop(): Promise<void> {
    await this.bot.stop();
  }

  async pw(expression: string): Promise<EnvelopeData> {
    const command = `pw ${expression}`;
    const validation = isFunctionExpression(expression);
    if (!validation.valid) return this.toolFailureEnvelope(command, validation.error!);

    const previousState = this.bot.stateManager().getCurrentState();
    let result: ActionResult | null = null;
    let executionError: unknown = null;

    try {
      const executed = await this.bot.getExplorer().action().execute(toCodeceptWrapper(expression));
      result = executed.actionResult;
    } catch (error) {
      executionError = error;
    }

    if (executionError) return this.heal(command, expression, executionError, previousState);

    result ||= await this.capturedResult(previousState);
    return this.successEnvelope(command, [expression], result, previousState);
  }

  async do(instructions: string[]): Promise<EnvelopeData> {
    const command = `do ${instructions.map((instruction) => `"${instruction}"`).join(' ')}`;
    const guard = await this.aiGuard(command);
    if (guard) return guard;

    const provider = this.bot.getProvider();
    const previousState = this.bot.stateManager().getCurrentState();
    const conversation = provider.startConversation(this.instructionSystemPrompt(), AI_AGENT_NAME);
    const task = new Task(instructions.join('; '), previousState?.url || '');
    const tools = createCodeceptJSTools({ explorer: this.bot.getExplorer(), stateManager: this.bot.stateManager(), ai: provider }, task);
    conversation.addUserText(this.instructionPrompt(instructions, await this.capturedResult(previousState)));

    const used: string[] = [];
    let failure: { code: string; message: string } | null = null;
    let aiError: unknown = null;
    let narration = '';
    let contextHash = this.bot.stateManager().getCurrentState()?.hash;

    for (let iteration = 1; iteration <= Math.min(instructions.length + 2, MAX_INSTRUCTION_ITERATIONS); iteration++) {
      const state = this.bot.stateManager().getCurrentState();
      if (iteration > 1 && state && state.hash !== contextHash) {
        contextHash = state.hash;
        conversation.addUserText(this.pageContext(ActionResult.fromState(state)));
      }

      const invoked = await provider.invokeConversation(conversation, tools, { maxToolRoundtrips: MAX_TOOL_ROUNDTRIPS, agentName: AI_AGENT_NAME }).catch((error: unknown) => {
        aiError = error;
        return null;
      });
      if (!invoked) break;

      const executions = invoked.toolExecutions || [];
      if (!executions.length) {
        narration = invoked.response?.text?.trim() || '';
        break;
      }

      for (const execution of executions) {
        if (!execution.wasSuccessful) {
          failure = { code: execution.output?.code || '', message: execution.output?.message || 'action failed' };
          continue;
        }
        used.push(...this.executedCodes(execution.output?.code));
        failure = null;
      }
    }

    if (aiError) return this.failureEnvelope(command, aiError, previousState);

    if (failure) {
      const envelope = await this.heal(command, failure.code || instructions.join('; '), failure.message, previousState);
      envelope.used = [...used, ...(envelope.used || [])];
      return envelope;
    }

    if (!used.length) {
      const reason = ['No action was performed for these instructions on the current page.', narration].filter(Boolean).join(' ');
      return this.failureEnvelope(command, reason, previousState);
    }

    const result = await this.capturedResult(this.bot.stateManager().getCurrentState());
    return this.successEnvelope(command, used, result, previousState);
  }

  async click(target: string): Promise<EnvelopeData> {
    return this.do([`click ${target}`]);
  }

  async fill(field: string, value: string): Promise<EnvelopeData> {
    return this.do([`fill ${field} with value: ${value}`]);
  }

  async ask(question: string): Promise<EnvelopeData> {
    const command = `ask ${question}`;
    const guard = await this.aiGuard(command);
    if (guard) return guard;

    const previousState = this.bot.stateManager().getCurrentState();
    const result = await this.capturedResult(previousState, { screenshot: this.visionEnabled() });
    return this.reportEnvelope(command, result, previousState, { answer: await this.answer(question, result) });
  }

  async verify(assertion: string): Promise<EnvelopeData> {
    const command = `verify ${assertion}`;
    const guard = await this.aiGuard(command);
    if (guard) return guard;

    const previousState = this.bot.stateManager().getCurrentState();
    const result = await this.capturedResult(previousState);
    const verification = await this.bot.agentNavigator().verifyState(assertion, result);
    const codes = verification.successfulCodes || [];
    const verdict = { passed: verification.verified, evidence: this.verdictEvidence(verification.verified, codes), code: codes.join('\n') };
    return this.reportEnvelope(command, result, previousState, { ok: verification.verified, verdict });
  }

  async research(opts: { data?: boolean; deep?: boolean; fresh?: boolean } = {}): Promise<EnvelopeData> {
    const flags = [opts.data && '--data', opts.deep && '--deep', opts.fresh && '--fresh'].filter(Boolean);
    const command = ['research', ...flags].join(' ');
    const guard = await this.aiGuard(command);
    if (guard) return guard;

    const previousState = this.bot.stateManager().getCurrentState();
    const result = await this.capturedResult(previousState);
    const uiMap = await this.bot.agentResearcher().research(result, { screenshot: true, data: opts.data, deep: opts.deep, force: opts.fresh });
    return this.reportEnvelope(command, result, previousState, { research: uiMap });
  }

  async go(target: string): Promise<EnvelopeData> {
    const command = `go ${target}`;
    const code = `I.amOnPage('${target}')`;
    const isUrl = this.isUrlTarget(target);

    if (!isUrl) {
      const guard = await this.aiGuard(command);
      if (guard) return guard;
    }

    const previousState = this.bot.stateManager().getCurrentState();
    let navigationError: unknown = null;

    try {
      await this.bot.agentNavigator().visit(target);
    } catch (error) {
      navigationError = error;
    }

    if (navigationError) return this.heal(command, code, navigationError, previousState);

    const used: string[] = [];
    if (isUrl) used.push(code);
    const result = await this.capturedResult(this.bot.stateManager().getCurrentState());
    return this.successEnvelope(command, used, result, previousState);
  }

  async browserStart(): Promise<void> {
    const config = await this.loadConfig();
    let show = config.playwright.show || false;
    if (this.options.show) show = true;
    if (this.options.headless) show = false;
    this.server = await this.launchOwnServer({ browser: config.playwright.browser, show }, this.instanceName());
  }

  async browserStop(all = false): Promise<boolean> {
    await this.loadConfig();

    if (!all) return this.stopInstance(this.instanceName());

    let stopped = false;
    for (const instance of listInstances()) {
      if (await this.stopInstance(instance.name)) stopped = true;
    }
    return stopped;
  }

  async browserStatus(): Promise<string> {
    await this.loadConfig();
    const info = await this.instanceInfo();
    const endpoint = await getAliveEndpoint(info.name);
    const others = info.others.map((other) => other.name).join(', ') || 'none';
    const lines = [`instance: ${info.name} (${info.tabs} ${pluralize(info.tabs, 'tab')}) | other instances: ${others}`];
    if (!endpoint) lines.push('browser: not running');
    if (endpoint) lines.push(`browser: running at ${endpoint}`);
    return lines.join('\n');
  }

  async browserList(): Promise<string> {
    await this.loadConfig();

    const lines: string[] = [];
    for (const instance of listInstances()) {
      const endpoint = await getAliveEndpoint(instance.name);
      if (!endpoint) continue;
      lines.push(`${instance.name}  ${endpoint}`);
    }

    if (!lines.length) return 'no browser instances running';
    return lines.join('\n');
  }

  async instanceInfo(): Promise<InstanceInfo> {
    const name = this.instanceName();
    const others = listInstances()
      .filter((instance) => instance.name !== name)
      .map((instance) => ({ name: instance.name, tabs: 0 }));

    return { name, tabs: this.tabCount(), others };
  }

  async toolFailureEnvelope(command: string, error: unknown): Promise<EnvelopeData> {
    const state = this.bot.getCurrentState();
    const instance = await this.instanceInfo().catch(() => ({ name: this.instanceName(), tabs: 0, others: [] }));
    const failure: EnvelopeData['failure'] = { error: `tool: ${browserErrorMessage(error)}`, attempts: [] };
    if (state?.ariaSnapshot) failure.compactAria = compactAriaSnapshot(state.ariaSnapshot, true);

    return {
      ok: false,
      command,
      page: { url: state?.url || '', title: state?.title || '', state: state?.hash || '', visits: 0 },
      failure,
      instance,
    };
  }

  private async loadConfig(): Promise<ExplorbotConfig> {
    return ConfigParser.getInstance().loadConfig({ config: this.options.config, path: this.options.path });
  }

  private async connectOwnInstance(): Promise<boolean> {
    return !!(await getAliveEndpoint(this.instanceName()));
  }

  private async launchOwnServer(opts: { browser?: string; show?: boolean }, instance: string): Promise<{ close: () => Promise<void> }> {
    return launchServer(opts, instance);
  }

  private async stopInstance(instance: string): Promise<boolean> {
    if (instance === this.instanceName()) {
      const server = this.server;
      this.server = null;
      await server?.close();
    }

    return stopServer(instance);
  }

  private isUrlTarget(target: string): boolean {
    const value = target.trim();
    if (value.startsWith('/')) return true;
    return URL.canParse(value);
  }

  private async heal(command: string, expression: string, error: unknown, previousState: WebPageState | null): Promise<EnvelopeData> {
    if (this.options.heal === false) return this.failureEnvelope(command, error, previousState);

    const navigator = this.healNavigator();
    if (!navigator) {
      const envelope = await this.failureEnvelope(command, error, previousState);
      envelope.healed = false;
      envelope.healNote = this.aiUnavailableNote();
      return envelope;
    }

    const message = dedent`
      I tried to run this command on the page: ${expression}
      But it failed with: ${browserErrorMessage(error)}
      Reach the same outcome on the current page in a different way.
    `;

    const attempts: Array<{ code: string; error?: string }> = [];
    const failedResult = await this.capturedResult(previousState);
    const resolved = await navigator.resolveState(message, failedResult, { onAttempt: (attempt) => attempts.push(attempt) }).catch(() => false);

    if (!resolved) {
      const healAttempts = attempts.map((attempt) => ({ code: attempt.code, outcome: attempt.error || 'ok' }));
      return this.failureEnvelope(command, error, previousState, healAttempts);
    }

    const used = attempts.filter((attempt) => !attempt.error).map((attempt) => attempt.code);
    const result = await this.capturedResult(this.bot.stateManager().getCurrentState());
    const envelope = await this.successEnvelope(command, used, result, previousState);
    envelope.healed = true;
    envelope.healNote = `recovered after ${attempts.length} ${pluralize(attempts.length, 'attempt')}`;
    return envelope;
  }

  private healNavigator(): Navigator | null {
    if (this.aiUnavailable()) return null;
    try {
      return this.bot.agentNavigator?.() ?? null;
    } catch {
      return null;
    }
  }

  private aiUnavailable(): string | null {
    try {
      if (this.bot.getProvider?.()) return null;
    } catch (error) {
      return browserErrorMessage(error);
    }
    return this.bot.aiFailureReason?.() || 'no AI model is configured';
  }

  private aiUnavailableNote(): string {
    const reason = this.aiUnavailable();
    if (!reason) return 'ai unavailable';
    return `ai unavailable: ${reason}`;
  }

  private async aiGuard(command: string): Promise<EnvelopeData | null> {
    const reason = this.aiUnavailable();
    if (!reason) return null;
    const message = `this command needs an AI model and none is usable: ${reason}. Drive the browser directly with playwright-cli or prima pw, or fix the AI config in ~/.explorbot/config.js or EXPLORBOT_AI_PROVIDER.`;
    return this.toolFailureEnvelope(command, message);
  }

  private instructionSystemPrompt(): string {
    return dedent`
      <role>
      You are a web automation engineer performing high-level instructions on the page that is already open in the browser.
      </role>

      <approach>
      1. Read the page context and perform the instructions in the order they are listed.
      2. Interact with the page only through the provided tools.
      3. Pick the smallest interaction that fulfills an instruction, then move to the next one.
      4. After the page changes, work from the updated context you are given, not from the earlier one.
      5. Stop calling tools when every instruction is done, or when an instruction cannot be performed on this page — say what is missing instead.
      </approach>

      ${locatorRule}

      ${actionRule}
    `;
  }

  private instructionPrompt(instructions: string[], result: ActionResult): string {
    const list = instructions.map((instruction, index) => `${index + 1}. ${instruction}`).join('\n');
    return dedent`
      <instructions>
      ${list}
      </instructions>

      ${this.pageContext(result)}
    `;
  }

  private pageContext(result: ActionResult): string {
    const experience = this.bot.experienceTracker?.()?.renderExperienceTocFor?.(result) || '';
    return dedent`
      <page url="${result.url}" title="${result.title}">
      ${compactAriaSnapshot(result.ariaSnapshot, true)}
      </page>

      ${experience}
    `;
  }

  private executedCodes(code: unknown): string[] {
    if (typeof code !== 'string') return [];
    return code
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line);
  }

  private visionEnabled(): boolean {
    if (this.options.noVision) return false;
    return this.bot.getProvider().hasVision?.() === true;
  }

  private async answer(question: string, result: ActionResult): Promise<string> {
    const seen = await this.visionAnswer(question, result);
    if (seen) return seen;

    const described = await this.textAnswer(question, result);
    if (this.options.noVision) return described;
    return `${described}\n\n(vision was unavailable, answered from page structure)`;
  }

  private async visionAnswer(question: string, result: ActionResult): Promise<string | null> {
    if (!this.visionEnabled()) return null;
    return this.bot.agentResearcher().answerQuestionAboutScreenshot(result, question);
  }

  private async textAnswer(question: string, result: ActionResult): Promise<string> {
    const provider = this.bot.getProvider();
    const summary = await this.bot.agentResearcher().summary(result);
    const prompt = dedent`
      Answer the question about the web page described below.
      Rely only on the page summary and the accessibility tree given here.
      When the answer is not present in them, say which part of the page would be needed instead of guessing.
      Keep the answer under five sentences.

      <question>
      ${question}
      </question>

      <page_summary>
      ${summary}
      </page_summary>

      <page_aria>
      ${compactAriaSnapshot(result.ariaSnapshot, true)}
      </page_aria>
    `;

    const response = await provider.chat([{ role: 'user', content: prompt }], provider.getModelForAgent?.(AI_AGENT_NAME), { agentName: AI_AGENT_NAME });
    return response?.text || '';
  }

  private verdictEvidence(verified: boolean, codes: string[]): string {
    if (!verified) return 'no assertion held on the current page';
    if (!codes.length) return 'already verified on this page';
    return `${codes[0]} passed`;
  }

  private async successEnvelope(command: string, used: string[], result: ActionResult, previousState: WebPageState | null): Promise<EnvelopeData> {
    return {
      ok: true,
      command,
      used,
      page: this.pageBlock(result, previousState),
      changes: await this.pageChanges(result, previousState, used[0]),
      instance: await this.instanceInfo(),
      artifacts: await this.writeSnapshot(result),
    };
  }

  private async failureEnvelope(command: string, error: unknown, previousState: WebPageState | null, attempts: HealAttempt[] = []): Promise<EnvelopeData> {
    const result = await this.capturedResult(previousState);
    const failure: EnvelopeData['failure'] = { error: browserErrorMessage(error), attempts };
    if (result.ariaSnapshot) failure.compactAria = compactAriaSnapshot(result.ariaSnapshot, true);
    if (attempts.length) failure.reasoning = [...new Set(attempts.map((attempt) => attempt.outcome))].join('; ');

    return {
      ok: false,
      command,
      page: this.pageBlock(result, previousState),
      failure,
      instance: await this.instanceInfo(),
      artifacts: await this.writeSnapshot(result),
    };
  }

  private async reportEnvelope(command: string, result: ActionResult, previousState: WebPageState | null, outcome: Partial<EnvelopeData>): Promise<EnvelopeData> {
    return {
      ok: true,
      command,
      page: this.pageBlock(result, previousState),
      ...outcome,
      instance: await this.instanceInfo(),
      artifacts: await this.writeSnapshot(result),
    };
  }

  private async capturedResult(previousState: WebPageState | null, opts: { screenshot?: boolean } = {}): Promise<ActionResult> {
    const captured = await this.bot
      .getExplorer()
      ?.capture(opts)
      .catch(() => null);
    if (captured) return captured;
    if (previousState) return ActionResult.fromState(previousState);
    return new ActionResult({ url: '' });
  }

  private pageBlock(result: ActionResult, previousState: WebPageState | null): EnvelopeData['page'] {
    return {
      url: result.url,
      previousUrl: previousState?.url,
      title: result.title,
      state: result.getStateHash(),
      visits: this.bot.stateManager().getVisitCount(result.url),
    };
  }

  private async pageChanges(result: ActionResult, previousState: WebPageState | null, code: string): Promise<string | null> {
    if (!previousState) return null;
    const toolResult = await result.toToolResult(ActionResult.fromState(previousState), code);
    return toolResult.pageDiff?.ariaChanges ?? null;
  }

  private async writeSnapshot(result: ActionResult): Promise<EnvelopeData['artifacts']> {
    return writeArtifacts(this.nextArtifactDir(), {
      aria: result.ariaSnapshot,
      html: await result.combinedHtml(),
      requests: this.bot.requestStore().getRequests(),
    });
  }

  private nextArtifactDir(): string {
    this.artifactsDir ||= outputPath('prima');
    return path.join(this.artifactsDir, new Date().toISOString().replace(/[:.]/g, '-'));
  }

  private tabCount(): number {
    const page = this.bot.getExplorer()?.page;
    if (!page) return 0;
    return page.context().pages().length;
  }

  private instanceName(): string {
    return this.options.instance || 'default';
  }
}

export interface PrimaOptions {
  verbose?: boolean;
  config?: string;
  path?: string;
  instance?: string;
  session?: string | boolean;
  heal?: boolean;
  ephemeral?: boolean;
  framework?: 'codeceptjs' | 'playwright';
  noVision?: boolean;
  url?: string;
  show?: boolean;
  headless?: boolean;
  endpoint?: string;
  pwSession?: string;
}
