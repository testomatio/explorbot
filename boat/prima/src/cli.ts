import { Command } from 'commander';
import { keepServerRunning } from '../../../src/browser-server.ts';
import { RecommendedModelsCommand } from '../../../src/commands/recommended-models-command.ts';
import { browserErrorMessage } from '../../../src/utils/browser-errors.ts';
import { isVerboseMode, setQuietMode } from '../../../src/utils/logger.ts';
import { clearActivityLine, trackActivityLine } from './activity-line.ts';
import { type EnvelopeData, renderEnvelope } from './envelope.ts';
import { askHelp, checkHelp, doHelp, helpContract, pageContextHelp, reportHelp, researchHelp, sessionHelp, statusHelp, verifyHelp } from './help.ts';
import { Prima, type PrimaOptions } from './prima.ts';

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
    show: options.show,
    headless: options.headless,
    endpoint: options.endpoint,
    pwSession: options.pwSession,
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
    .option('--ephemeral', 'Keep no state between runs; applies to config-free runs, where output goes to a temp directory')
    .option('--framework <name>', 'Not active yet: framework the reported code targets, codeceptjs or playwright')
    .option('--url <url>', 'Page to open when the session has no page yet')
    .option('--spec <path>', 'Docbot application spec directory or index.md to read as page knowledge')
    .option('--endpoint <ep>', 'Websocket endpoint of a browser server to attach to, skipping discovery')
    .option('--pw-session <title>', 'Title of the playwright-cli session to attach to')
    .addHelpText('after', `\n${sessionHelp}`);
}

function primaFor(options: any, command?: string): Prima {
  Prima.applyEnv();
  if (options.ephemeral) process.env.EXPLORBOT_EPHEMERAL = '1';
  if (options.model) process.env.EXPLORBOT_AI_MODEL = options.model;
  if (options.visionModel) process.env.EXPLORBOT_VISION_MODEL = options.visionModel;
  if (options.spec) process.env.EXPLORBOT_SPEC = options.spec;
  return new Prima({ ...buildOptions(options), command: command?.split(' ')[0] });
}

async function runPrima(options: any, command: string, run: (prima: Prima) => Promise<EnvelopeData>): Promise<void> {
  setQuietMode(!isVerboseMode());
  trackActivityLine();
  const prima = primaFor(options, command);
  const startedAt = Date.now();

  let envelope: EnvelopeData;
  try {
    await prima.start();
    envelope = await run(prima);
  } catch (error) {
    envelope = await prima.toolFailureEnvelope(command, error);
  }

  prima.record(envelope, Date.now() - startedAt);
  clearActivityLine();
  console.log(renderEnvelope(envelope));
  await prima.stop().catch(() => {});
  process.exit(envelope.ok ? 0 : 1);
}

async function runBrowser(options: any, run: (prima: Prima) => Promise<boolean>): Promise<void> {
  let ok = false;
  try {
    ok = await run(primaFor(options));
  } catch (error) {
    console.error(browserErrorMessage(error));
    process.exit(1);
  }

  process.exit(ok ? 0 : 1);
}

export function createPrimaCommands(name = 'prima'): Command {
  const cmd = new Command(name);
  cmd.description('Tests and drives a web app through described behaviour instead of locators: one command carries a whole scenario, verifies it, and reports the proof');
  cmd.option('--pw-session <title>', 'Title of the playwright-cli session to attach to');
  cmd.option('--url <url>', 'Page to open when the session has no page yet');
  cmd.addHelpText('after', `\n${helpContract}`);
  rootOptions = () => cmd.opts();

  addCommonOptions(cmd.command('pw <fn>').description('Run a Playwright function expression against the open page')).action(async (fn, options) => {
    await runPrima(options, `pw ${fn}`, (prima) => prima.pw(fn));
  });

  addCommonOptions(cmd.command('do <instructions...>').description('Run high-level instructions tester-style, one argument per instruction'))
    .addHelpText('after', `\n${doHelp}\n\n${pageContextHelp}`)
    .action(async (instructions, options) => {
      await runPrima(options, `do ${instructions.join(' ')}`, (prima) => prima.do(instructions));
    });

  addCommonOptions(cmd.command('check <scenario>').description('Run a scenario end to end as a test, with its own verification, and report the steps it took'))
    .option('--expected <outcome>', 'An outcome the run must reach; repeat the flag for several', (value: string, all: string[]) => [...all, value], [])
    .addHelpText('after', `\n${checkHelp}\n\n${pageContextHelp}`)
    .action(async (scenario, options) => {
      await runPrima(options, `check ${scenario}`, (prima) => prima.check(scenario, options.expected));
    });

  addCommonOptions(cmd.command('ask <question>').description('Answer a question about the current page').option('--no-vision', 'Answer from page structure only, without a screenshot'))
    .addHelpText('after', `\n${askHelp}`)
    .action(async (question, options) => {
      await runPrima(options, `ask ${question}`, (prima) => prima.ask(question));
    });

  addCommonOptions(cmd.command('verify <assertion>').alias('assert').description('Assert a statement about the current page'))
    .addHelpText('after', `\n${verifyHelp}`)
    .action(async (assertion, options) => {
      await runPrima(options, `verify ${assertion}`, (prima) => prima.verify(assertion));
    });

  addCommonOptions(cmd.command('research').description('Map the current page and return verified locators').option('--data', 'Include data extraction in the map').option('--deep', 'Expand hidden elements for a deeper map').option('--fresh', 'Ignore the cached map and research the page again'))
    .addHelpText('after', `\n${researchHelp}`)
    .action(async (options) => {
      await runPrima(options, 'research', (prima) => prima.research({ data: options.data, deep: options.deep, fresh: options.fresh }));
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

  addCommonOptions(cmd.command('status <hash>').description('Show the artifacts and page detail recorded for an earlier command'))
    .addHelpText('after', `\n${statusHelp}`)
    .action(async (hash, options) => {
      setQuietMode(!isVerboseMode());
      const prima = primaFor(options);
      const envelope = await prima.status(hash).catch((error: unknown) => prima.toolFailureEnvelope(`status ${hash}`, error));
      console.log(renderEnvelope(envelope));
      process.exit(envelope.ok ? 0 : 1);
    });

  addCommonOptions(cmd.command('report').description('Turn every command of a session into one html and markdown report'))
    .addHelpText('after', `\n${reportHelp}`)
    .action(async (options) => {
      setQuietMode(!isVerboseMode());
      console.log(
        await primaFor(options)
          .report()
          .catch((error: unknown) => browserErrorMessage(error))
      );
      process.exit(0);
    });

  const browser = cmd.command('browser').description('Manage the browsers prima drives');

  addCommonOptions(browser.command('start').description('Start a prima-owned browser and hold it open until Ctrl+C'))
    .option('-s, --show', 'Launch the browser in a visible window')
    .option('--headless', 'Launch the browser without a window')
    .action(async (options) => {
      await runBrowser(options, async (prima) => {
        await prima.browserStart();
        console.log(await prima.browserStatus());
        return keepServerRunning(() => prima.browserStop());
      });
    });

  addCommonOptions(browser.command('stop').description('Stop the browser of this instance'))
    .option('--all', 'Stop every running instance')
    .action(async (options) => {
      await runBrowser(options, async (prima) => {
        const stopped = await prima.browserStop(options.all);
        console.log(await prima.browserStatus());
        return stopped;
      });
    });

  addCommonOptions(browser.command('status').description('Report the browser of this instance')).action(async (options) => {
    await runBrowser(options, async (prima) => {
      console.log(await prima.browserStatus());
      return true;
    });
  });

  addCommonOptions(browser.command('list').description('List every browser instance that is running')).action(async (options) => {
    await runBrowser(options, async (prima) => {
      console.log(await prima.browserList());
      return true;
    });
  });

  return cmd;
}
