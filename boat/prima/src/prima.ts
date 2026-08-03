import path from 'node:path';
import dedent from 'dedent';
import { ActionResult } from '../../../src/action-result.ts';
import { getAliveEndpoint, listInstances } from '../../../src/browser-server.ts';
import { outputPath } from '../../../src/config.ts';
import { ExplorBot } from '../../../src/explorbot.ts';
import type { WebPageState } from '../../../src/state-manager.ts';
import { browserErrorMessage } from '../../../src/utils/browser-errors.ts';
import { type EnvelopeData, type InstanceInfo, writeArtifacts } from './envelope.ts';
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

    try {
      const executed = await this.bot.getExplorer().action().execute(toCodeceptWrapper(expression));
      result = executed.actionResult;
    } catch (error) {
      return this.failureEnvelope(command, error, previousState);
    }

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

  private async failureEnvelope(command: string, error: unknown, previousState: WebPageState | null): Promise<EnvelopeData> {
    const result = await this.capturedResult(previousState);

    return {
      ok: false,
      command,
      page: this.pageBlock(result, previousState),
      failure: { error: browserErrorMessage(error), attempts: [] },
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
