import { Command } from 'commander';
import dedent from 'dedent';
import { keepServerRunning } from '../../../src/browser-server.ts';
import { browserErrorMessage } from '../../../src/utils/browser-errors.ts';
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
    used: is code that already executed - CodeceptJS steps to copy as they are, except
          for pw, whose Playwright expression a test needs inside I.usePlaywrightTo(...).
    Log lines can precede the envelope; start parsing at the first ### line.

  HEALING AND FAILURE
    A failed action is retried by AI along a different route; healed: true means the
    outcome was reached another way and used: holds the code that worked.
    --no-heal skips that and fails fast.
    Failures print compact ARIA inline, so retarget from the envelope itself and open
    the artifact files only when the inline snapshot is not enough.

  SESSIONS
    By default prima attaches to the playwright-cli browser of this workspace and works
    on the tabs it already has open; driving the same session from both tools is the
    intended usage.
    playwright-cli open <url>  the session prima attaches to
    --pw-session <title>       which playwright-cli session, when several are open
    --endpoint <ep>            attach to a browser server endpoint directly
    prima browser start        a prima-owned browser instead, when no session is open
    --instance <name>          which prima-owned browser you talk to; parallel work
                               needs one each
    --session [file]           cookies and storage persisted across processes; ignored
                               while attached, the attached session keeps its own
    Prima never launches a browser implicitly and never closes an attached one - it
    disconnects. browser list shows both kinds; ### Instance names the one you are on.
    Every browser is reached over a Playwright browser-server endpoint, which needs the
    Node build - run prima as "npx explorbot prima ..." or through the published prima
    bin; from source under Bun the connection does not open.
    When no AI model is usable pw still works; for everything else drive
    playwright-cli directly.
    Parsed but not active yet: --framework, so reported code is CodeceptJS whatever
    you pass.
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
    .option('--ephemeral', 'Keep no state between runs; applies to config-free runs, where output goes to a temp directory')
    .option('--framework <name>', 'Not active yet: framework the reported code targets, codeceptjs or playwright')
    .option('--url <url>', 'Page to open when the session has no page yet')
    .option('--endpoint <ep>', 'Websocket endpoint of a browser server to attach to, skipping discovery')
    .option('--pw-session <title>', 'Title of the playwright-cli session to attach to');
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
    if (!options.url && URL.canParse(target)) options.url = target;
    await runPrima(options, `go ${target}`, (prima) => prima.go(target));
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
