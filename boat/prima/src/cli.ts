import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { RecommendedModelsCommand } from '../../../src/commands/recommended-models-command.ts';
import { providerWithKey } from '../../../src/config.ts';
import { Observability } from '../../../src/observability.ts';
import { browserErrorMessage } from '../../../src/utils/browser-errors.ts';
import { isVerboseMode, setQuietMode } from '../../../src/utils/logger.ts';
import { safeFilename } from '../../../src/utils/strings.ts';
import { clearActivityLine, trackActivityLine } from './activity-line.ts';
import { type EnvelopeData, renderEnvelope } from './envelope.ts';
import { bareHelp, installHelp, npxHint, skillPointer } from './help.ts';
import { Prima, type PrimaOptions } from './prima.ts';
import { PrimaSkill } from './skill.ts';

export const { version } = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));

let rootOptions: () => any = () => ({});

function buildOptions(subcommand: any): PrimaOptions {
  const options = { ...rootOptions(), ...stripEmpty(subcommand) };
  return {
    config: options.config,
    path: options.path,
    instance: options.instance,
    session: options.session,
    ephemeral: options.ephemeral,
    framework: options.framework,
    noVision: options.vision === false,
    url: options.url,
    baseUrl: options.baseUrl,
    endpoint: options.endpoint,
    pwSession: options.pwSession,
    purpose: options.purpose,
    video: options.video,
  };
}

function stripEmpty(options: any): any {
  const present: any = {};
  for (const [key, value] of Object.entries(options || {})) {
    if (value === undefined) continue;
    present[key] = value;
  }
  return present;
}

function addCommonOptions(cmd: Command): Command {
  return cmd
    .option('-c, --config <path>', 'Path to explorbot configuration file')
    .option('-p, --path <path>', 'Working directory path')
    .option('-i, --instance <name>', 'Browser instance to drive')
    .option('--session [file]', 'Persist cookies and storage to a session file')
    .option('--model <model>', 'Main model, as provider/model-id')
    .option('--vision-model <model>', 'Model for screenshot analysis, as provider/model-id')
    .option('--ephemeral', 'Keep no state; config-free runs use a temp directory')
    .option('--framework <name>', 'Inactive: reported code targets codeceptjs or playwright')
    .option('--url <url>', 'Page to open when the session has no page yet')
    .option('--spec <path>', 'Docbot application spec directory or index.md to read as page knowledge')
    .option('--endpoint <ep>', 'Websocket endpoint of a browser server to attach to, skipping discovery')
    .option('--pw-session <title>', 'Title of the playwright-cli session to attach to')
    .option('--purpose <text>', 'What a series of commands is for; groups them into one Langfuse session, report and video');
}

function primaFor(options: any): Prima {
  Prima.applyEnv();
  if (options.ephemeral) process.env.EXPLORBOT_EPHEMERAL = '1';
  if (options.model) process.env.EXPLORBOT_AI_MODEL = options.model;
  if (options.visionModel) process.env.EXPLORBOT_VISION_MODEL = options.visionModel;
  if (options.spec) process.env.EXPLORBOT_SPEC = options.spec;
  return new Prima(buildOptions(options));
}

async function runPrima(options: any, command: string, run: (prima: Prima) => Promise<EnvelopeData>, opts: { browser?: boolean; record?: boolean } = {}): Promise<void> {
  const { browser = true, record = true } = opts;
  setQuietMode(!isVerboseMode());
  trackActivityLine();
  const prima = primaFor(options);
  const startedAt = Date.now();

  let envelope: EnvelopeData;
  try {
    if (browser) await prima.start();
    await prima.startVideo();
    envelope = await Observability.run(command, { tags: ['prima'], sessionId: options.purpose && safeFilename(options.purpose) }, () => run(prima));
  } catch (error) {
    envelope = await prima.toolFailureEnvelope(command, error);
  }

  await prima.stopVideo(envelope);
  if (record) prima.record(envelope, Date.now() - startedAt);
  clearActivityLine();
  console.log(renderEnvelope(envelope));
  if (npxHint()) console.error(`hint: ${npxHint()}`);
  await prima.stop().catch(() => {});
  process.exit(envelope.ok ? 0 : 1);
}

export function createPrimaCommands(name = 'prima'): Command {
  const cmd = new Command(name);
  cmd.description('Drives a web app through described behaviour, not locators');
  cmd.version(version, '-V, --version');
  cmd.option('--pw-session <title>', 'Title of the playwright-cli session to attach to');
  cmd.option('--url <url>', 'Page to open when the session has no page yet');
  cmd.addHelpText('after', `\n${skillPointer}`);
  cmd
    .allowExcessArguments()
    .allowUnknownOption()
    .action(() => {
      if (cmd.args.length) cmd.error(`error: unknown command '${cmd.args[0]}'`);
      console.log(bareHelp);
      if (npxHint()) console.log(`\n${npxHint()}`);
    });
  rootOptions = () => cmd.opts();

  cmd
    .command('skill')
    .description('Print the skill that teaches a coding agent to use prima, or install it')
    .option('--install [scope]', 'Install for Claude Code, Codex and OpenCode: local (this project) or global (home directory)')
    .action((options) => {
      if (!options.install) {
        console.log(PrimaSkill.render());
        console.error(installHelp);
        if (!providerWithKey()) console.error('\nNo provider API key is set: see "Getting an API key" in the skill.');
        return;
      }
      let scope = 'local';
      if (options.install !== true) scope = options.install;
      if (!PrimaSkill.scopes().includes(scope)) cmd.error(`error: unknown install scope '${scope}', use ${PrimaSkill.scopes().join(' or ')}`);
      for (const file of PrimaSkill.install(scope)) console.log(`installed ${file}`);
    });

  addCommonOptions(cmd.command('pw <fn>').description('Run a Playwright function expression against the open page')).action(async (fn, options) => {
    await runPrima(options, `pw ${fn}`, (prima) => prima.pw(fn));
  });

  addCommonOptions(cmd.command('do <instructions...>').description('Run instructions, one argument each'))
    .option('--video', 'Record this command for prima video; needs --purpose and ffmpeg')
    .action(async (instructions, options) => {
      await runPrima(options, `do ${instructions.join(' ')}`, (prima) => prima.do(instructions));
    });

  addCommonOptions(cmd.command('check <scenario>').description('Run a scenario as a test, with verification'))
    .option('--expected <outcome>', 'An outcome the run must reach; repeat the flag for several', (value: string, all: string[]) => [...all, value], [])
    .option('--video', 'Record this command for prima video; needs --purpose and ffmpeg')
    .action(async (scenario, options) => {
      await runPrima(options, `check ${scenario}`, (prima) => prima.check(scenario, options.expected));
    });

  addCommonOptions(cmd.command('ask <question>').description('Answer a question about the current page').option('--no-vision', 'Answer from page structure only, without a screenshot')).action(async (question, options) => {
    await runPrima(options, `ask ${question}`, (prima) => prima.ask(question));
  });

  addCommonOptions(cmd.command('verify <assertion>').alias('assert').description('Assert a statement about the current page')).action(async (assertion, options) => {
    await runPrima(options, `verify ${assertion}`, (prima) => prima.verify(assertion));
  });

  addCommonOptions(
    cmd.command('research').description('Map the current page and return verified locators').option('--data', 'Include data extraction in the map').option('--deep', 'Expand hidden elements for a deeper map').option('--fresh', 'Ignore the cached map and research the page again')
  ).action(async (options) => {
    await runPrima(options, 'research', (prima) => prima.research({ data: options.data, deep: options.deep, fresh: options.fresh }));
  });

  addCommonOptions(cmd.command('ux [focus]').description('Review the area being worked on for UX issues, across breakpoints')).action(async (focus, options) => {
    await runPrima(options, ['ux', focus].filter(Boolean).join(' '), (prima) => prima.ux(focus));
  });

  addCommonOptions(cmd.command('go <target>').description('Navigate to a url, a path, or a page described in plain words')).action(async (target, options) => {
    if (URL.canParse(target)) options.baseUrl = target;
    await runPrima(options, `go ${target}`, (prima) => prima.go(target));
  });

  addCommonOptions(cmd.command('config').description('Show models, config file and paths used by this run'))
    .option('--json', 'Print the resolved config as JSON')
    .action(async (options) => {
      setQuietMode(!isVerboseMode());
      const prima = primaFor(options);
      console.log(await prima.config(options.json).catch((error: unknown) => browserErrorMessage(error)));
      await prima.stop().catch(() => {});
      process.exit(0);
    });

  RecommendedModelsCommand.register(cmd);

  addCommonOptions(cmd.command('status <hash>').description('Show the artifacts and page detail recorded for an earlier command')).action(async (hash, options) => {
    await runPrima(options, `status ${hash}`, (prima) => prima.status(hash), { browser: false, record: false });
  });

  addCommonOptions(cmd.command('report').description('Turn every command of a session into one html and markdown report')).action(async (options) => {
    setQuietMode(!isVerboseMode());
    console.log(
      await primaFor(options)
        .report()
        .catch((error: unknown) => browserErrorMessage(error))
    );
    process.exit(0);
  });

  const repeat = (value: string, all: string[]) => [...all, value];
  addCommonOptions(cmd.command('video').description('Join the do and check recordings of a purpose into one video, with optional edits'))
    .option('--list', 'List the commands of the purpose with their numbers')
    .option('--only <numbers>', 'Commands to join, in this order, e.g. 0001,0003,0002; repeatable', repeat, [])
    .option('--caption <number=text>', 'Caption shown over one command, e.g. 0002="Add to cart"; repeatable', repeat, [])
    .option('--speed <number=factor>', 'Play one command faster (2) or slower (0.5); repeatable', repeat, [])
    .option('--hold <number=seconds>', 'Hold the last frame of one command for this long; repeatable', repeat, [])
    .action(async (options) => {
      setQuietMode(!isVerboseMode());
      const output = await primaFor(options)
        .video({ list: options.list, only: options.only, caption: options.caption, speed: options.speed, hold: options.hold })
        .catch((error: unknown) => browserErrorMessage(error));
      console.log(output);
      process.exit(0);
    });

  addCommonOptions(cmd.command('browser').description('Open a playwright-cli session for prima to drive, or report the one already open')).action(async (options) => {
    try {
      console.log(await primaFor(options).browserCheck());
    } catch (error) {
      console.error(browserErrorMessage(error));
      process.exit(1);
    }
    process.exit(0);
  });

  return cmd;
}
