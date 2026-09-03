import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { tool } from 'ai';
import dedent from 'dedent';
import * as playwright from 'playwright';
import type { Browser } from 'playwright';
import { z } from 'zod';
import { ActionResult } from '../../../src/action-result.ts';
import { getPreviousResearch } from '../../../src/ai/researcher/cache.ts';
import { actionRule, locatorRule } from '../../../src/ai/rules.ts';
import { createAgentTools, createCodeceptJSTools, createRefTools } from '../../../src/ai/tools.ts';
import { getAliveEndpoint, launchServer, listInstances, stopServer } from '../../../src/browser-server.ts';
import { ConfigCommand } from '../../../src/commands/config-command.ts';
import { ConfigMissingError, ConfigParser, EXPLORBOT_ENV_VARS, type ExplorbotConfig, outputPath } from '../../../src/config.ts';
import { ExplorBot } from '../../../src/explorbot.ts';
import { findSiteWith, listSites } from '../../../src/global-config.ts';
import { Reporter } from '../../../src/reporter.ts';
import type { WebPageState } from '../../../src/state-manager.ts';
import { Stats } from '../../../src/stats.ts';
import { Task, Test, TestResult } from '../../../src/test-plan.ts';
import { compactAriaSnapshot } from '../../../src/utils/aria.ts';
import { browserErrorMessage } from '../../../src/utils/browser-errors.ts';
import { pluralize } from '../../../src/utils/logger.ts';
import { mdq } from '../../../src/utils/markdown-query.ts';
import { safeFilename } from '../../../src/utils/strings.ts';
import { type EnvelopeData, type InstanceInfo, STATUS_FILE, readArtifacts, writeArtifacts } from './envelope.ts';
import { isFunctionExpression, takePwValue, toCodeceptWrapper } from './pw-parser.ts';
import { type PwServerDescriptor, readDescriptors, selectDescriptor } from './pw-registry.ts';
import { type SessionRun, latestSessionFile, readSession, recordCommand, sessionFile, sessionsDir } from './session-log.ts';

const WITHHELD_TOOLS = ['learnExperience', 'askUser', 'research'];
const ITERATIONS_PER_INSTRUCTION = 2;
const MAX_INSTRUCTION_ITERATIONS = 24;
const CONTEXT_HTML_CAP = 6000;
const MAX_TOOL_ROUNDTRIPS = 5;
const AI_AGENT_NAME = 'prima';
const CONNECT_TIMEOUT = 3000;
const requireLib = createRequire(import.meta.url);

const VOLATILE_COLUMNS = ['CSS', 'XPath', 'Coordinates', 'eidx'];
const UNACCOUNTED: Record<string, string> = { open: 'the run ended without confirming this one — the actions above are everything that ran' };

function dropVolatileColumns(markdown: string): string {
  return mdq(markdown)
    .query('table')
    .replaceEach((table) => {
      const rows = table.toJson();
      if (!rows.length) return table.text();

      const columns = Object.keys(rows[0]).filter((name) => !VOLATILE_COLUMNS.includes(name));
      if (!columns.length) return table.text();

      const header = `| ${columns.join(' | ')} |`;
      const divider = `|${columns.map(() => '------').join('|')}|`;
      const body = rows.map((row) => `| ${columns.map((name) => row[name] || '-').join(' | ')} |`);
      return [header, divider, ...body, ''].join('\n');
    });
}

function cap(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n[...truncated; ${text.length - max} chars omitted...]`;
}

export class Prima {
  private options: PrimaOptions;
  private bot: ExplorBot;
  private artifactsDir?: string;
  private hash?: string;
  private sessionUrl?: string;
  private server: { close: () => Promise<void> } | null = null;
  private attached: string | null = null;
  private session: SessionRun | null = null;
  private artifacts?: EnvelopeData['artifacts'];

  constructor(options: PrimaOptions = {}) {
    this.options = options;
    this.bot = new ExplorBot({
      config: options.config,
      path: options.path,
      baseUrl: this.configBaseUrl(),
      session: options.session,
      instance: options.instance,
      headless: true,
      optionalAi: true,
      reporter: { enabled: false },
    });
  }

  static applyEnv(): void {
    for (const { name } of EXPLORBOT_ENV_VARS) {
      const value = process.env[name.replace('EXPLORBOT_', 'PRIMA_CLI_')];
      if (!value) continue;
      process.env[name] = value;
    }
  }

  async start(): Promise<void> {
    let discovery: Discovery | undefined;
    if (!this.options.endpoint) {
      discovery = await this.discover();
      this.adoptSessionUrl(discovery);
    }

    const config = await this.loadConfig();
    await this.resolveBrowser(config, discovery);
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

    const previousState = await this.baselineState();
    let result: ActionResult | null = null;
    let returnedValue: unknown;
    let executionError: unknown = null;

    try {
      const executed = await this.bot.getExplorer().action().execute(toCodeceptWrapper(expression), { verbatim: true });
      result = executed.actionResult;
      returnedValue = executed.lastValue;
    } catch (error) {
      executionError = error;
    }

    if (executionError) return this.failureEnvelope(command, executionError, previousState);

    result ||= await this.capturedResult(previousState);
    const envelope = await this.successEnvelope(command, [expression], result, previousState);
    envelope.value = takePwValue(returnedValue);
    return envelope;
  }

  async do(instructions: string[], label?: string): Promise<EnvelopeData> {
    const command = label || `do ${instructions.map((instruction) => `"${instruction}"`).join(' ')}`;
    const guard = await this.aiGuard(command);
    if (guard) return guard;

    const provider = this.bot.getProvider();
    const previousState = await this.baselineState();
    const conversation = provider.startConversation(this.instructionSystemPrompt(), AI_AGENT_NAME);
    const task = new Task(instructions.join('; '), previousState?.url || '');
    const deps = { explorer: this.bot.getExplorer(), stateManager: this.bot.stateManager(), ai: provider };
    const ledger: LedgerEntry[] = instructions.map((text) => ({ text, status: 'open', proof: '' }));
    const descent = { markup: false };
    const tools = { ...createCodeceptJSTools(deps, task), ...createRefTools(deps, task), ...this.testerTools(deps), context: this.contextTool(descent), completed: this.completedTool(), blocked: this.blockedTool() };
    conversation.addUserText(await this.instructionPrompt(instructions, await this.capturedResult(previousState)));

    const used: string[] = [];
    const trace: Array<{ label: string; ok: boolean; proof: string }> = [];
    let failure: { code: string; message: string } | null = null;
    let aiError: unknown = null;
    let narration = '';
    let nudged = false;
    let contextHash = this.bot.stateManager().getCurrentState()?.hash;

    for (let iteration = 1; iteration <= Math.min(instructions.length * ITERATIONS_PER_INSTRUCTION + 2, MAX_INSTRUCTION_ITERATIONS); iteration++) {
      const state = this.bot.stateManager().getCurrentState();
      if (iteration > 1 && state && state.hash !== contextHash) {
        contextHash = state.hash;
        conversation.addUserText(await this.pageContext(ActionResult.fromState(state)));
      }

      if (iteration > 1) {
        conversation.addUserText(dedent`
          <progress>
          ${this.ledgerProgress(ledger)}
          </progress>

          Call completed() now for every open instruction the page already shows is satisfied, before you act again.
        `);
      }

      const invoked = await provider.invokeConversation(conversation, tools, { maxToolRoundtrips: MAX_TOOL_ROUNDTRIPS, agentName: AI_AGENT_NAME }).catch((error: unknown) => {
        aiError = error;
        return null;
      });
      if (!invoked) break;

      const executions = invoked.toolExecutions || [];
      if (!executions.length) {
        narration = invoked.response?.text?.trim() || '';
        const unreported = this.openInstructions(ledger);
        if (!unreported || nudged) break;
        nudged = true;
        conversation.addUserText(dedent`
          These instructions are still unreported:
          ${unreported}

          Report each one with completed() or blocked(). Do not act again on anything you have already carried out.
        `);
        continue;
      }

      for (const execution of executions) {
        const output = execution.output || {};

        if (this.applyLedgerReport(execution, ledger, trace)) continue;

        if (output.action === 'verify' && !output.inexpressible) {
          const claim = execution.input?.assertion || 'verification';
          let passed = execution.wasSuccessful;
          if (output.alreadyVerified) passed = output.verifications?.[claim] === true;
          trace.push({ label: `verify: ${claim}`, ok: passed, proof: output.code || '' });
          continue;
        }

        if (!execution.wasSuccessful) {
          failure = { code: output.code || '', message: output.message || 'action failed' };
          trace.push({ label: output.code || execution.toolName || 'action', ok: false, proof: output.message || '' });
          await this.writeStepFiles(trace.length, output.code || execution.toolName || 'action', '');
          continue;
        }

        const codes = this.executedCodes(output.code);
        used.push(...codes);
        trace.push({ label: codes.join('; ') || execution.toolName || 'action', ok: true, proof: '' });
        await this.writeStepFiles(trace.length, codes.join(' ') || execution.toolName || 'action', output.pageDiff?.ariaChanges || '');
        failure = null;
      }

      if (ledger.every((entry) => entry.status !== 'open')) break;
    }

    if (aiError) return this.failureEnvelope(command, aiError, previousState);

    if (trace.length && ledger.some((entry) => entry.status === 'open')) {
      await this.settleLedger(conversation, provider, ledger, trace);
    }

    const unfinished = ledger.filter((entry) => entry.status !== 'done');
    const steps = [...trace, ...ledger.filter((entry) => entry.status === 'open').map((entry) => ({ label: entry.text, ok: false, unconfirmed: true, proof: UNACCOUNTED.open }))];

    if (failure && unfinished.length) {
      const envelope = await this.failureEnvelope(command, failure.message, previousState);
      envelope.steps = steps;
      envelope.stepFiles = this.statusDir();
      return envelope;
    }

    if (!trace.length && unfinished.length === ledger.length) {
      const reason = ['No action was performed for these instructions on the current page.', narration].filter(Boolean).join(' ');
      return this.failureEnvelope(command, reason, previousState);
    }

    const result = await this.capturedResult(this.bot.stateManager().getCurrentState());
    const envelope = await this.successEnvelope(command, used, result, previousState);
    envelope.steps = steps;
    envelope.stepFiles = this.statusDir();
    // the step log already reports every action and what it changed
    envelope.used = undefined;
    envelope.changes = undefined;

    const blocked = ledger.filter((entry) => entry.status === 'blocked');
    if (blocked.length) {
      envelope.ok = false;
      envelope.failure = { error: blocked.map((entry) => `blocked: ${entry.text}${entry.proof ? ` — ${entry.proof}` : ''}`).join('\n') };
    }
    return envelope;
  }

  private openInstructions(ledger: LedgerEntry[]): string {
    return ledger
      .map((entry, index) => ({ entry, number: index + 1 }))
      .filter(({ entry }) => entry.status === 'open')
      .map(({ entry, number }) => `${number}. ${entry.text}`)
      .join('\n');
  }

  private applyLedgerReport(execution: any, ledger: LedgerEntry[], trace: Array<{ label: string; ok: boolean; proof: string }>): boolean {
    const action = execution.output?.action;

    if (action === 'completed') {
      const closed: string[] = [];
      for (const number of execution.input?.numbers || []) {
        const entry = ledger[number - 1];
        if (entry?.status !== 'open') continue;
        entry.status = 'done';
        entry.proof = execution.input?.proof || '';
        closed.push(entry.text);
      }
      // one report carries one proof, however many instructions it closed
      if (closed.length) trace.push({ label: `done: ${closed.join('; ')}`, ok: true, proof: execution.input?.proof || '' });
      return true;
    }

    if (action !== 'blocked') return false;

    const entry = ledger[(execution.input?.instruction || 0) - 1];
    if (entry?.status === 'open') {
      entry.status = 'blocked';
      entry.proof = execution.input?.reason || '';
      trace.push({ label: `blocked: ${entry.text}`, ok: false, proof: entry.proof });
    }
    return true;
  }

  private async settleLedger(conversation: any, provider: any, ledger: LedgerEntry[], trace: Array<{ label: string; ok: boolean; proof: string }>): Promise<void> {
    conversation.addUserText(dedent`
      The run is over and these instructions were never reported:

      ${this.openInstructions(ledger)}

      Judge each one against what you saw at the time it was due, not against the page as it stands now — later
      instructions have moved it on, and something you confirmed earlier stays confirmed even if it is gone.
      completed() for those, blocked() for the ones the page could not do. Report every one — nothing else runs after this.
    `);

    let settleError: unknown = null;
    const invoked = await provider.invokeConversation(conversation, { completed: this.completedTool(), blocked: this.blockedTool() }, { maxToolRoundtrips: 2, toolChoice: 'required', agentName: AI_AGENT_NAME }).catch((error: unknown) => {
      settleError = error;
      return null;
    });

    if (settleError) trace.push({ label: 'settling which instructions were satisfied', ok: false, proof: browserErrorMessage(settleError) });

    for (const execution of invoked?.toolExecutions || []) {
      this.applyLedgerReport(execution, ledger, trace);
    }
  }

  private ledgerProgress(ledger: LedgerEntry[]): string {
    return ledger
      .map((entry, index) => {
        const head = `${index + 1}. ${entry.status} — ${entry.text}`;
        if (entry.status === 'open') return head;
        return `${head} (${entry.proof})`;
      })
      .join('\n');
  }

  async check(scenario: string, expected: string[] = []): Promise<EnvelopeData> {
    const command = `check ${scenario}`;
    const guard = await this.aiGuard(command);
    if (guard) return guard;

    const previousState = await this.baselineState();
    const outcomes = expected.length ? expected : [scenario];
    const test = new Test(scenario, 'normal', outcomes, previousState?.url || this.options.url || '');
    const tester = this.bot.agentTester();

    await tester.test(test, { startOnCurrentPage: true });

    const notes = Object.values(test.notes || {}) as Array<{ message: string; status?: string; log?: string; observation?: boolean }>;
    const result = await this.capturedResult(this.bot.stateManager().getCurrentState(), { screenshot: this.visionEnabled() });
    const envelope = await this.reportEnvelope(command, result, previousState, {});
    const recorded = notes.filter((note) => !note.observation && !outcomes.includes(note.message));
    const failed = recorded.filter((note) => note.status === TestResult.FAILED);
    envelope.steps = failed.map((note) => ({ label: note.message, ok: false, proof: note.log || '' }));

    const routine = recorded.length - failed.length;
    if (routine) envelope.steps.push({ label: `${routine} further ${pluralize(routine, 'step')} ran without failing — prima status ${envelope.status} for the full log`, ok: true, proof: '' });

    envelope.expectations = await this.bot.agentPilot().settleExpectations(test, result);

    if (!result.screenshot || !this.visionEnabled()) {
      envelope.warning = 'These outcomes were settled from the run log alone — no screenshot backed them. Set ai.visionModel, or check anything visual with prima ask.';
    }

    const unreached = envelope.expectations.filter((expectation) => expectation.status === 'failed');
    const contradicted = envelope.expectations.filter((expectation) => expectation.status === 'contradiction');
    envelope.ok = !unreached.length && !contradicted.length;

    const problems = [...unreached.map((expectation) => `not reached: ${expectation.text}`), ...contradicted.map((expectation) => `the picture and the run disagree about: ${expectation.text}`)];
    if (problems.length) envelope.failure = { error: problems.join('\n') };

    if (!test.hasFinished || test.isSkipped) {
      envelope.ok = false;
      envelope.failure = { error: `the run did not complete, so it established nothing about the app: ${notes.at(-1)?.message || 'no steps were recorded'}` };
    }

    const observations = notes.filter((note) => note.observation).map((note) => note.message);
    if (observations.length) envelope.answer = ['Page problems noticed while running, not step failures:', ...observations.map((line) => `- ${line}`)].join('\n');
    return envelope;
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
    const outcome: Partial<EnvelopeData> = { assertions: verification.results || [] };

    if (verification.inexpressible) {
      const question = `Judging only from the screenshot, is this true of the page: "${assertion}"? Answer true, false or undetermined, and say what settles it.`;
      const seen = await this.visionAnswer(question, await this.capturedResult(previousState, { screenshot: this.visionEnabled() }));
      if (seen) outcome.answer = `No assertion could express this claim, so it was judged from a screenshot instead.\n\n${seen}`;
    }

    return this.reportEnvelope(command, result, previousState, outcome);
  }

  async research(opts: { data?: boolean; deep?: boolean; fresh?: boolean } = {}): Promise<EnvelopeData> {
    const flags = [opts.data && '--data', opts.deep && '--deep', opts.fresh && '--fresh'].filter(Boolean);
    const command = ['research', ...flags].join(' ');
    const guard = await this.aiGuard(command);
    if (guard) return guard;

    const previousState = this.bot.stateManager().getCurrentState();
    const result = await this.capturedResult(previousState);
    const uiMap = await this.bot.agentResearcher().research(result, { screenshot: true, data: opts.data, deep: opts.deep, force: opts.fresh });
    return this.reportEnvelope(command, result, previousState, { research: dropVolatileColumns(uiMap) });
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

    if (navigationError) return this.failureEnvelope(command, navigationError, previousState);

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
    if (this.attached) return false;

    if (!all) return this.stopInstance(this.instanceName());

    let stopped = false;
    for (const instance of listInstances()) {
      if (await this.stopInstance(instance.name)) stopped = true;
    }
    return stopped;
  }

  async config(json?: boolean): Promise<string> {
    const [site] = listSites();
    if (site && !this.configBaseUrl()) this.sessionUrl = site.url;
    const config = await this.loadConfig();
    const parser = ConfigParser.getInstance();

    return ConfigCommand.render(config, { configPath: parser.getConfigPath(), root: parser.getProjectRoot(), json });
  }

  record(envelope: EnvelopeData, durationMs: number): void {
    if (!this.session) return;
    recordCommand(sessionFile(this.session.key), this.session, envelope, durationMs);
  }

  async report(): Promise<string> {
    const [site] = listSites();
    if (site && !this.configBaseUrl()) this.sessionUrl = site.url;
    await this.loadConfig();

    let file = latestSessionFile();
    if (this.options.pwSession) file = sessionFile(this.options.pwSession);
    if (!file || !existsSync(file)) return `No prima session was recorded under ${sessionsDir()}. Commands are recorded as they run.`;

    const session = readSession(file);
    if (!session.tests.length) return `No commands are recorded in ${file}`;

    Stats.sessionName = path.basename(file, '.jsonl');
    process.env.TESTOMATIO_TITLE = session.title;
    const reporter = new Reporter({ html: true, markdown: true });

    // the report pipes narrate themselves on console.log; prima prints the paths itself
    const speak = console.log;
    console.log = () => {};
    try {
      for (const test of session.tests) await reporter.reportTestData(test.status, test);
      await reporter.finishRun();
    } finally {
      console.log = speak;
    }

    return [
      `${session.tests.length} ${pluralize(session.tests.length, 'command')} from ${file}`,
      `html:     ${outputPath('reports', `${Stats.sessionLabel()}.html`)}`,
      `markdown: ${outputPath('reports', `${Stats.sessionLabel()}-tests.md`)}`,
      `upload:   TESTOMATIO=<apiKey> npx @testomatio/reporter replay ${file}`,
    ].join('\n');
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
      lines.push(`prima --instance ${instance.name}  ${endpoint}`);
    }

    const discovery = await this.discover();
    await discovery.browser?.close().catch(() => {});
    for (const descriptor of discovery.candidates) {
      lines.push(`playwright-cli --pw-session ${descriptor.title}  ${descriptor.endpoint}`);
    }

    if (!lines.length) return 'no browser instances running';
    return lines.join('\n');
  }

  async instanceInfo(): Promise<InstanceInfo> {
    const name = this.instanceName();
    const others = listInstances()
      .filter((instance) => instance.name !== name)
      .map((instance) => ({ name: instance.name, tabs: 0 }));

    const info: InstanceInfo = { name, tabs: this.tabCount(), others };
    if (this.attached) info.attached = this.attached;
    return info;
  }

  async toolFailureEnvelope(command: string, error: unknown): Promise<EnvelopeData> {
    const state = this.bot.getCurrentState();
    const instance = await this.instanceInfo().catch(() => ({ name: this.instanceName(), tabs: 0, others: [] }));
    const failure: EnvelopeData['failure'] = { error: `tool: ${browserErrorMessage(error)}` };
    if (error instanceof ConfigMissingError) failure.error = browserErrorMessage(error);
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
    const config = await ConfigParser.getInstance().loadConfig({ config: this.options.config, path: this.options.path, baseUrl: this.configBaseUrl() });
    const ai = config.ai;
    if (ai) {
      ai.agents ??= {};
      ai.agents.researcher ??= {};
      ai.agents.researcher.enabled ??= this.options.command === 'research';
    }
    return config;
  }

  private configBaseUrl(): string | undefined {
    const url = this.options.baseUrl || this.options.url || this.sessionUrl;
    if (!url) return undefined;
    if (!URL.canParse(url)) return undefined;
    return url;
  }

  private adoptSessionUrl(discovery: Discovery): void {
    if (this.options.baseUrl || this.options.url) return;

    const url = discovery.browser?.contexts()[0]?.pages()[0]?.url();
    if (!url?.startsWith('http')) return;
    this.sessionUrl = new URL(url).origin;
    this.bot.getOptions().baseUrl = this.sessionUrl;
  }

  private async resolveBrowser(config: ExplorbotConfig, discovered?: Discovery): Promise<void> {
    if (this.options.endpoint) {
      const endpoint = this.options.endpoint;
      const browserName = config.playwright.browser || 'chromium';
      const known = readDescriptors().find((descriptor) => descriptor.endpoint === endpoint);
      if (await this.attachToEndpoint({ file: '', title: '', endpoint, workspaceDir: '', browserName, playwrightLib: known?.playwrightLib || '' })) return;
      throw new Error(dedent`
        No browser answered at ${endpoint}.
        Check the endpoint of the running session, or drop --endpoint to let prima pick
        the playwright-cli session itself.
      `);
    }

    const { match, candidates, browser } = discovered || (await this.discover());
    if (match && (await this.attachToEndpoint(match, browser))) return;

    if (!match && candidates.length) {
      const titles = candidates.map((candidate) => candidate.title).join(', ');
      throw new Error(dedent`
        Several playwright-cli sessions are open: ${titles}
        Pick one with --pw-session <title>.
      `);
    }

    if (await this.connectOwnInstance()) return;

    throw new Error(dedent`
      No browser to drive for instance "${this.instanceName()}".
      Open one first:
        playwright-cli open <url>   prima attaches to this workspace session by default
        prima browser start         starts a prima-owned browser instead
      Prima never launches a browser implicitly.
    `);
  }

  private async discover(descriptors = readDescriptors()): Promise<Discovery> {
    const title = this.options.pwSession ?? process.env.PLAYWRIGHT_CLI_SESSION;
    const opts = { title };

    const alive = new Map<PwServerDescriptor, Browser>();
    for (const candidate of selectDescriptor(descriptors, opts).candidates) {
      const browser = await this.connectDescriptor(candidate);
      if (browser) alive.set(candidate, browser);
    }

    const selected = selectDescriptor([...alive.keys()], opts);
    const discovery: Discovery = { match: selected.match, candidates: selected.candidates };
    if (selected.match) discovery.browser = alive.get(selected.match);

    for (const [descriptor, browser] of alive) {
      if (descriptor === selected.match) continue;
      await browser.close().catch(() => {});
    }

    return discovery;
  }

  private async attachToEndpoint(descriptor: PwServerDescriptor, probed?: Browser): Promise<boolean> {
    const browser = probed || (await this.connectDescriptor(descriptor));
    if (!browser) return false;

    this.bot.attachBrowser(browser);
    this.attached = this.attachmentLabel(descriptor);
    this.session = { key: descriptor.title || this.instanceName(), endpoint: descriptor.endpoint, title: `prima session "${descriptor.title || this.instanceName()}"` };
    return true;
  }

  private async connectDescriptor(descriptor: PwServerDescriptor): Promise<Browser | null> {
    const connected = await this.connectWith(this.descriptorLib(descriptor), descriptor);
    if (connected) return connected;
    return this.connectWith(playwright, descriptor);
  }

  private async connectWith(lib: any, descriptor: PwServerDescriptor): Promise<Browser | null> {
    const launcher = lib?.[descriptor.browserName];
    if (!launcher?.connect) return null;
    return launcher.connect(descriptor.endpoint, { timeout: CONNECT_TIMEOUT }).catch(() => null);
  }

  private descriptorLib(descriptor: PwServerDescriptor): any {
    if (!descriptor.playwrightLib) return null;
    try {
      return requireLib(descriptor.playwrightLib);
    } catch {
      return null;
    }
  }

  private attachmentLabel(descriptor: PwServerDescriptor): string {
    if (!descriptor.title) return `endpoint ${descriptor.endpoint}`;
    if (!descriptor.workspaceDir) return `playwright-cli session "${descriptor.title}"`;
    return `playwright-cli session "${descriptor.title}", workspace ${descriptor.workspaceDir}`;
  }

  private async connectOwnInstance(): Promise<boolean> {
    const endpoint = await getAliveEndpoint(this.instanceName());
    if (!endpoint) return false;
    this.session = { key: this.instanceName(), endpoint, title: `prima instance "${this.instanceName()}"` };
    return true;
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

  private aiUnavailable(): string | null {
    try {
      if (this.bot.getProvider?.()) return null;
    } catch (error) {
      return browserErrorMessage(error);
    }
    return this.bot.aiFailureReason?.() || 'no AI model is configured';
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
      1. Read the page context and carry out the instructions in the order they are listed.
      2. Interact with the page only through the provided tools.
      3. Pick the smallest interaction that fulfills an instruction, then move to the next one.
      4. After the page changes, work from the updated context you are given, not from the earlier one.
      5. Account for every instruction: completed() as soon as one is satisfied, blocked() when the page cannot do what it asks.
      </approach>

      <ledger>
      Instructions are numbered and those numbers never change. Report by number.
      Saying in your reply that something is done does not report it — only completed() does. Nothing you write is read as a report.
      Report an instruction the moment the page shows it is satisfied, before moving on. Waiting until later is how work gets repeated.
      An instruction you have reported is finished. Never act on it again, and never report it twice.
      After each turn you are shown every instruction with its state. Act only on the ones still open — repeating an action that already
      landed can undo it, since a control that opened something will close it again.
      Reaching for blocked() after a couple of honest attempts costs less than a third attempt that fails the same way.
      </ledger>

      <scope>
      Do only what the instructions ask. An action that looks helpful but was not asked for is out of scope — report it as something you noticed, never perform it.
      Continuing past the last instruction is a failure, even when the next step seems obvious.
      An instruction worded as a condition — do X if Y appears — is satisfied the moment you can see Y is absent. Say so and move on. Never search for something the page does not show.
      </scope>

      <pace>
      Work in as few turns as you can. When the next actions are already determined by what you can see, ask for them together in one turn rather than one at a time — each turn costs a full round trip.
      Only stop to look again when what you find changes what you would do next.
      A batch may not run past an instruction that inspects the page — settle that one first, because the actions after it destroy the state it would have read.
      </pace>

      <proof>
      An instruction is done only when a change on the page shows it. After each action read the reported change and decide which part of it proves the instruction.
      That part is what completed() takes as its proof. Do not restate the action as if it were the outcome.
      How much of the page moved is not evidence of whether it happened — a change confined to one region proves an instruction as well as one that redraws everything.
      An instruction that only inspects the page is satisfied by what you can see, including seeing that something is absent — those need no action at all.
      </proof>

      <targets>
      The page context lists every element with a ref, like [ref=e14]. To click one, pass that ref to clickRef — a ref names one
      exact element, so it cannot match several by mistake and costs nothing to resolve. This is the cheapest way to act.
      Use click() with a role and name for anything clickRef cannot take, and narrow with the container it sits in when a name
      appears more than once, rather than guessing at an id or a class.
      Refs belong to the context you were given. Use the ones in your newest context, never one you invented or remembered from
      an older page. When the element an instruction needs is missing from that context, call context() and act on what it returns.
      </targets>

      ${locatorRule}

      ${actionRule}

      <targets_first>
      Everything above about composing locators applies to click() and the other locator tools. It does not apply when the
      element carries a ref: pass that ref to clickRef instead and compose nothing. Reach for a locator only for elements
      that have no ref, or when a ref has stopped resolving.
      </targets_first>
    `;
  }

  private async instructionPrompt(instructions: string[], result: ActionResult): Promise<string> {
    const list = instructions.map((instruction, index) => `${index + 1}. ${instruction}`).join('\n');
    return dedent`
      <instructions>
      ${list}
      </instructions>

      ${await this.pageContext(result)}
    `;
  }

  private testerTools(deps: any): any {
    const researcher = this.bot.agentResearcher?.();
    const navigator = this.bot.agentNavigator?.();
    if (!researcher || !navigator) return {};

    const tools = createAgentTools({ ...deps, researcher, navigator, withExperience: false });
    for (const name of WITHHELD_TOOLS) delete tools[name];
    return tools;
  }

  private completedTool(): any {
    return tool({
      description: dedent`
        Report the instructions you have just satisfied, by their number. Report several together when one turn satisfied several.
        A reported instruction is finished — you will not be asked for it again and must not act on it again.
      `,
      inputSchema: z.object({
        numbers: z.array(z.number()).describe('Numbers of the instructions now satisfied, as they are numbered in the instruction list'),
        proof: z.string().describe('What on the page shows they are satisfied'),
      }),
      execute: async () => ({ success: true, action: 'completed' }),
    });
  }

  private blockedTool(): any {
    return tool({
      description: dedent`
        Report one instruction that cannot be carried out on this page, by its number. Reach for this instead of trying the same thing again.
        The rest of the sequence continues without it.
      `,
      inputSchema: z.object({
        instruction: z.number().describe('Number of the instruction that cannot be carried out'),
        reason: z.string().describe('What stopped it — what you looked for and what the page showed instead'),
      }),
      execute: async () => ({ success: true, action: 'blocked' }),
    });
  }

  private contextTool(descent: { markup: boolean }): any {
    let refreshed = false;
    return tool({
      description: dedent`
        Look at the page again when the refs you hold no longer resolve, or when the element an instruction needs is not in the context you were given.
        The first call returns the page as it is now, with fresh refs that replace every ref you were holding.
        A later call on the same page drops to the raw markup, for elements the accessibility tree does not describe.
        Do not call it to confirm an action worked — the change is already reported back to you.
      `,
      inputSchema: z.object({
        reason: z.string().describe('Which element you cannot reach and what you already tried'),
      }),
      execute: async () => {
        const result = await this.capturedResult(this.bot.stateManager().getCurrentState());
        if (!refreshed) {
          refreshed = true;
          return { success: true, context: await this.pageContext(result) };
        }
        descent.markup = true;
        return { success: true, context: cap(await result.simplifiedHtml(), CONTEXT_HTML_CAP) };
      },
    });
  }

  private async pageContext(result: ActionResult): Promise<string> {
    const experience = this.bot.experienceTracker?.()?.renderExperienceTocFor?.(result) || '';
    const map = getPreviousResearch(result.baseHash);
    let uiMap = '';
    if (map) {
      uiMap = dedent`
        <page_ui_map>
        A map of this page recorded by an earlier research run. It names parts the accessibility
        tree does not, and can be out of date — the tree is what the page holds now.
        ${map}
        </page_ui_map>
      `;
    }

    return dedent`
      <page url="${result.url}" title="${result.title}">
      ${compactAriaSnapshot(await this.refAriaSnapshot(result), true, (value) => this.offloadValue(value))}
      </page>

      ${uiMap}

      ${experience}
    `;
  }

  private offloadValue(value: string): string | undefined {
    const dir = this.statusDir();
    const name = `value-${createHash('sha1').update(value).digest('hex').slice(0, 8)}.txt`;
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, name), value, 'utf-8');
    } catch {
      return undefined;
    }
    return path.join(path.basename(dir), name);
  }

  private async refAriaSnapshot(result: ActionResult): Promise<string | null> {
    const snapshot = await Promise.resolve(this.bot.getExplorer()?.withPage?.((page: any) => page.locator('body').ariaSnapshot({ mode: 'ai' }))).catch(() => null);
    return snapshot || result.ariaSnapshot;
  }

  private executedCodes(code: unknown): string[] {
    if (typeof code !== 'string') return [];
    return code
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('//'));
  }

  private visionEnabled(): boolean {
    if (this.options.noVision) return false;
    if (Stats.visionDisabled) return false;
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

  private async successEnvelope(command: string, used: string[], result: ActionResult, previousState: WebPageState | null): Promise<EnvelopeData> {
    const changes = await this.pageChanges(result, previousState, used[0]);
    const status = await this.saveStatus(result);
    return {
      ok: true,
      command,
      used,
      page: this.pageBlock(result, previousState),
      changes,
      instance: await this.instanceInfo(),
      status,
      artifacts: this.artifacts,
    };
  }

  private async failureEnvelope(command: string, error: unknown, previousState: WebPageState | null): Promise<EnvelopeData> {
    const result = await this.capturedResult(previousState);
    const failure: EnvelopeData['failure'] = { error: browserErrorMessage(error) };
    if (result.ariaSnapshot) failure.compactAria = compactAriaSnapshot(result.ariaSnapshot, true);

    const status = await this.saveStatus(result);
    return {
      ok: false,
      command,
      page: this.pageBlock(result, previousState),
      failure,
      instance: await this.instanceInfo(),
      status,
      artifacts: this.artifacts,
    };
  }

  private async reportEnvelope(command: string, result: ActionResult, previousState: WebPageState | null, outcome: Partial<EnvelopeData>): Promise<EnvelopeData> {
    const status = await this.saveStatus(result);
    return {
      ok: true,
      command,
      page: this.pageBlock(result, previousState),
      ...outcome,
      instance: await this.instanceInfo(),
      status,
      artifacts: this.artifacts,
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

  private async baselineState(): Promise<WebPageState | null> {
    const existing = this.bot.stateManager?.()?.getCurrentState();
    if (existing) return existing;

    const result = await Promise.resolve(this.bot.getExplorer?.()?.capture?.()).catch(() => null);
    if (!result) return null;
    return this.bot.stateManager?.()?.updateState(result) ?? null;
  }

  private async pageChanges(result: ActionResult, previousState: WebPageState | null, code: string): Promise<string> {
    if (!previousState) return 'no snapshot was captured before this command, so nothing could be compared';
    const toolResult = await result.toToolResult(ActionResult.fromState(previousState), code);
    const pageDiff = toolResult.pageDiff;
    if (!pageDiff?.urlChanged) return pageDiff?.ariaChanges || 'no change';

    const lines = [`left ${previousState.url} for ${result.url}`];
    for (const message of pageDiff.messages ?? []) lines.push(`- ${message}`);
    return lines.join('\n');
  }

  async status(hash: string): Promise<EnvelopeData> {
    if (!this.artifactsDir) {
      const site = findSiteWith(path.join('output', 'prima', hash)) || listSites()[0];
      if (site && !this.configBaseUrl()) this.sessionUrl = site.url;
      await this.loadConfig();
    }

    const dir = this.statusDir(hash);
    const statusFile = path.join(dir, STATUS_FILE);
    if (!existsSync(statusFile)) return this.toolFailureEnvelope(`status ${hash}`, `No command was recorded under ${dir}. Every envelope prints its own hash on the Instance line.`);

    const saved = JSON.parse(readFileSync(statusFile, 'utf-8'));
    return {
      ok: true,
      command: `status ${hash}`,
      page: saved.page,
      instance: await this.instanceInfo(),
      artifacts: readArtifacts(dir),
    };
  }

  private async saveStatus(result: ActionResult): Promise<string> {
    const hash = this.statusHash();
    await this.writeSnapshot(result);
    writeFileSync(path.join(this.statusDir(hash), STATUS_FILE), JSON.stringify({ page: this.pageBlock(result, null) }), 'utf-8');
    return hash;
  }

  private async writeStepFiles(index: number, label: string, diff: string): Promise<void> {
    const state = this.bot.stateManager().getCurrentState();
    if (!state) return;

    const dir = this.statusDir();
    mkdirSync(dir, { recursive: true });
    const stem = path.join(dir, `${index}-${safeFilename(label.slice(0, 60))}`);
    const result = ActionResult.fromState(state);

    writeFileSync(`${stem}.aria.yaml`, result.ariaSnapshot ?? '', 'utf-8');
    writeFileSync(`${stem}.html`, await result.combinedHtml(), 'utf-8');
    if (diff) writeFileSync(`${stem}.diff.yaml`, diff, 'utf-8');
  }

  private async writeSnapshot(result: ActionResult): Promise<void> {
    this.artifacts = writeArtifacts(this.statusDir(), {
      aria: result.ariaSnapshot,
      html: await result.combinedHtml(),
      screenshot: result.screenshot,
      requests: this.bot.requestStore().getMadeRequests(),
    });
  }

  private statusHash(): string {
    this.hash ||= createHash('sha1')
      .update(`${this.options.path || process.cwd()}-${Date.now()}`)
      .digest('hex')
      .slice(0, 15);
    return this.hash;
  }

  private statusDir(hash = this.statusHash()): string {
    this.artifactsDir ||= outputPath('prima');
    return path.join(this.artifactsDir, hash);
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

interface Discovery {
  match?: PwServerDescriptor;
  candidates: PwServerDescriptor[];
  browser?: Browser;
}

interface LedgerEntry {
  text: string;
  status: 'open' | 'done' | 'blocked';
  proof: string;
}

export interface PrimaOptions {
  config?: string;
  path?: string;
  instance?: string;
  session?: string | boolean;
  ephemeral?: boolean;
  framework?: 'codeceptjs' | 'playwright';
  noVision?: boolean;
  url?: string;
  baseUrl?: string;
  show?: boolean;
  headless?: boolean;
  endpoint?: string;
  pwSession?: string;
  command?: string;
}
