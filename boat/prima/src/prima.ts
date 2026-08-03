import path from 'node:path';
import dedent from 'dedent';
import { ActionResult } from '../../../src/action-result.ts';
import type { Navigator } from '../../../src/ai/navigator.ts';
import { getAliveEndpoint, listInstances } from '../../../src/browser-server.ts';
import { outputPath } from '../../../src/config.ts';
import { ExplorBot } from '../../../src/explorbot.ts';
import type { WebPageState } from '../../../src/state-manager.ts';
import { compactAriaSnapshot } from '../../../src/utils/aria.ts';
import { browserErrorMessage } from '../../../src/utils/browser-errors.ts';
import { pluralize } from '../../../src/utils/logger.ts';
import { type EnvelopeData, type HealAttempt, type InstanceInfo, writeArtifacts } from './envelope.ts';
import { isFunctionExpression, toCodeceptWrapper } from './pw-parser.ts';

export class Prima {
  private options: PrimaOptions;
  private bot: ExplorBot;
  private artifactsDir?: string;

  constructor(options: PrimaOptions = {}) {
    this.options = options;
    this.bot = new ExplorBot({
      config: options.config,
      path: options.path,
      verbose: options.verbose,
      session: options.session,
      instance: options.instance,
      headless: true,
    });
  }

  async start(): Promise<void> {
    if (!(await this.connectOwnInstance())) {
      throw new Error(dedent`
        No browser session found for instance "${this.instanceName()}".
        Create one first:
          playwright-cli open <url>   preferred, prima drives that session
          prima browser start        starts a prima-owned browser
        Prima never launches a browser implicitly.
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

  async instanceInfo(): Promise<InstanceInfo> {
    const name = this.instanceName();
    const others = listInstances()
      .filter((instance) => instance.name !== name)
      .map((instance) => ({ name: instance.name, tabs: 0 }));

    return { name, tabs: this.tabCount(), others };
  }

  private async connectOwnInstance(): Promise<boolean> {
    return !!(await getAliveEndpoint(this.instanceName()));
  }

  private async heal(command: string, expression: string, error: unknown, previousState: WebPageState | null): Promise<EnvelopeData> {
    if (this.options.heal === false) return this.failureEnvelope(command, error, previousState);

    const navigator = this.healNavigator();
    if (!navigator) {
      const envelope = await this.failureEnvelope(command, error, previousState);
      envelope.healed = false;
      envelope.healNote = 'ai unavailable';
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
    try {
      if (!this.bot.getProvider?.()) return null;
      return this.bot.agentNavigator?.() ?? null;
    } catch {
      return null;
    }
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
    if (attempts.length) {
      failure.reasoning = [...new Set(attempts.map((attempt) => attempt.outcome))].join('; ');
      failure.compactAria = compactAriaSnapshot(result.ariaSnapshot, true);
    }

    return {
      ok: false,
      command,
      page: this.pageBlock(result, previousState),
      failure,
      instance: await this.instanceInfo(),
      artifacts: await this.writeSnapshot(result),
    };
  }

  private async toolFailureEnvelope(command: string, error: string): Promise<EnvelopeData> {
    const state = this.bot.stateManager().getCurrentState();

    return {
      ok: false,
      command,
      page: { url: state?.url || '', title: state?.title || '', state: state?.hash || '', visits: 0 },
      failure: { error: `tool: ${error}`, attempts: [] },
      instance: await this.instanceInfo(),
    };
  }

  private async capturedResult(previousState: WebPageState | null): Promise<ActionResult> {
    const captured = await this.bot
      .getExplorer()
      ?.capture()
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
  session?: string;
  heal?: boolean;
  ephemeral?: boolean;
  framework?: 'codeceptjs' | 'playwright';
  noVision?: boolean;
  url?: string;
}
