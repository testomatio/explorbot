import { Command } from 'commander';
import dedent from 'dedent';
import { keepServerRunning } from '../../../src/browser-server.ts';
import { setPreserveConsoleLogs } from '../../../src/utils/logger.ts';
import { type EnvelopeData, renderEnvelope } from './envelope.ts';
import { Prima, type PrimaOptions } from './prima.ts';

const helpContract = dedent`
  Prima drives a browser that is already open. One command per process; every command
  prints a plain-text envelope on stdout and exits 0 when ok, 1 when not.

  TIERS - choose by what you hold, not by how hard the step looks
    pw <fn>        Precise. A Playwright function expression built from a locator you
                   already verified. No AI on the happy path.
                     prima pw "({ page }) => page.click('[data-test=submit]')"
    click / fill   One action described in words; AI resolves it on the current page.
                     prima click "the primary action button in the header"
                     prima fill "the search box" "a search term"
    do <steps...>  Several described steps, run tester-style in one process.
                     prima do "open the account menu" "choose the settings entry"
    Never pass a locator or a function expression to click/fill/do - describe the target.
    Never pass a description to pw - it takes executable code only.

  LOOP
    prima go <url|path|words>  reach the page you want to work on
    prima research             once per new page; returns verified locators
    prima pw "..."             drive the page with those locators
    prima verify "..."         assert the outcome (prima ask "..." to inspect instead)
    Fall back to click/fill/do whenever research left you no locator to hold.

  ENVELOPE
    ### Result     ok, command, healed, used
    ### Page       url, title, state hash, visit count
    ### Changes    what the accessibility tree gained or lost
    ### Answer | ### Research | ### Verdict   output of ask, research, verify
    ### Failure    error, reasoning, healing attempts, compact ARIA of the page
    ### Instance   the browser you are on and the other instances running
    ### Artifacts  paths to the full aria.yml, page.html and network.jsonl
    used: is verified code that already executed - copy it into a test as is.
    Set EXPLORBOT_NO_BANNER=1 so nothing but the envelope reaches stdout.

  HEALING AND FAILURE
    A failed action is retried by AI along a different route; healed: true means the
    outcome was reached another way and used: holds the code that worked.
    --no-heal skips that and fails fast.
    Failures print compact ARIA inline, so retarget from the envelope itself and open
    the artifact files only when the inline snapshot is not enough.

  SESSIONS
    --instance <name>  which browser process you talk to; parallel work needs one each
    --session [file]   cookies and storage persisted across processes
    --endpoint, --pw-session  attach to a browser opened by playwright-cli
    Prima never launches a browser implicitly. Open one with playwright-cli (preferred)
    or with prima browser start, and close it when finished - ### Instance lists what
    you own. When no AI model is usable pw still works; for everything else drive
    playwright-cli directly.
`;

function buildOptions(options: any): PrimaOptions {
  return {
    verbose: options.verbose || options.debug,
    config: options.config,
    path: options.path,
    instance: options.instance,
    session: options.session,
    heal: options.heal,
    ephemeral: options.ephemeral,
    framework: options.framework,
    noVision: options.vision === false,
    url: options.url,
    show: options.show,
    headless: options.headless,
    endpoint: options.endpoint,
    pwSession: options.pwSession,
  };
}

function addCommonOptions(cmd: Command): Command {
  return cmd
    .option('-v, --verbose', 'Enable verbose logging')
    .option('--debug', 'Enable debug logging (same as --verbose)')
    .option('-c, --config <path>', 'Path to explorbot configuration file')
    .option('-p, --path <path>', 'Working directory path')
    .option('-i, --instance <name>', 'Browser instance to drive')
    .option('--session [file]', 'Persist cookies and storage to a session file')
    .option('--no-heal', 'Fail immediately instead of letting AI retry a failed action')
    .option('--ephemeral', 'Keep no state between runs, output goes to a temp directory')
    .option('--framework <name>', 'Framework the reported code targets: codeceptjs or playwright')
    .option('--url <url>', 'Page to open when the session has no page yet')
    .option('--endpoint <ep>', 'Websocket endpoint of a playwright-cli browser to attach to')
    .option('--pw-session <title>', 'Title of a playwright-cli session to attach to');
}

function primaFor(options: any): Prima {
  setPreserveConsoleLogs(true);
  if (options.ephemeral) process.env.EXPLORBOT_EPHEMERAL = '1';
  return new Prima(buildOptions(options));
}

async function runPrima(options: any, command: string, run: (prima: Prima) => Promise<EnvelopeData>): Promise<void> {
  const prima = primaFor(options);

  let envelope: EnvelopeData;
  try {
    await prima.start();
    envelope = await run(prima);
  } catch (error) {
    envelope = await prima.toolFailureEnvelope(command, error);
  }

  console.log(renderEnvelope(envelope));
  await prima.stop().catch(() => {});
  process.exit(envelope.ok ? 0 : 1);
}

export function createPrimaCommands(name = 'prima'): Command {
  const cmd = new Command(name);
  cmd.description('Drive an already-open browser one command at a time and report back in a plain-text envelope');
  cmd.addHelpText('after', `\n${helpContract}`);

  addCommonOptions(cmd.command('pw <fn>').description('Run a Playwright function expression against the open page')).action(async (fn, options) => {
    await runPrima(options, `pw ${fn}`, (prima) => prima.pw(fn));
  });

  addCommonOptions(cmd.command('do <instructions...>').description('Run high-level instructions tester-style, one argument per instruction')).action(async (instructions, options) => {
    await runPrima(options, `do ${instructions.join(' ')}`, (prima) => prima.do(instructions));
  });

  addCommonOptions(cmd.command('click <target>').description('Click an element described in plain words')).action(async (target, options) => {
    await runPrima(options, `click ${target}`, (prima) => prima.click(target));
  });

  addCommonOptions(cmd.command('fill <field> <value>').description('Fill a field described in plain words')).action(async (field, value, options) => {
    await runPrima(options, `fill ${field} ${value}`, (prima) => prima.fill(field, value));
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

  addCommonOptions(cmd.command('go <target>').description('Navigate to a url, a path, or a page described in plain words')).action(async (target, options) => {
    await runPrima(options, `go ${target}`, (prima) => prima.go(target));
  });

  const browser = cmd.command('browser').description('Manage the browsers prima drives');

  addCommonOptions(browser.command('start').description('Start a prima-owned browser and hold it open until Ctrl+C'))
    .option('-s, --show', 'Launch the browser in a visible window')
    .option('--headless', 'Launch the browser without a window')
    .action(async (options) => {
      const prima = primaFor(options);
      await prima.browserStart();
      console.log(await prima.browserStatus());
      keepServerRunning(() => prima.browserStop());
    });

  addCommonOptions(browser.command('stop').description('Stop the browser of this instance'))
    .option('--all', 'Stop every running instance')
    .action(async (options) => {
      const prima = primaFor(options);
      await prima.browserStop(options.all);
      console.log(await prima.browserStatus());
    });

  addCommonOptions(browser.command('status').description('Report the browser of this instance')).action(async (options) => {
    console.log(await primaFor(options).browserStatus());
  });

  addCommonOptions(browser.command('list').description('List every browser instance that is running')).action(async (options) => {
    console.log(await primaFor(options).browserList());
  });

  return cmd;
}
