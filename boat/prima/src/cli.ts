import { Command } from 'commander';
import dedent from 'dedent';
import { keepServerRunning } from '../../../src/browser-server.ts';
import { browserErrorMessage } from '../../../src/utils/browser-errors.ts';
import { setQuietMode } from '../../../src/utils/logger.ts';
import { type EnvelopeData, renderEnvelope } from './envelope.ts';
import { Prima, type PrimaOptions } from './prima.ts';

const helpContract = dedent`
  Prima drives a browser that is already open. One command per process; every command
  prints a plain-text envelope on stdout and exits 0 when ok, 1 when not.

  TIERS - choose by what you hold, not by how hard the step looks
    pw <fn>        Precise. A Playwright function expression built from a locator you
                   already verified. No AI on the happy path.
                     prima pw "({ page }) => page.click('[data-test=submit]')"
    check <scenario>
                   A whole scenario run as a test: it drives the page, verifies the outcome
                   itself, and reports every step it took with the proof for each.
                     prima check "the workflow editor opens and a workflow can be saved"
    do <steps...>  Several described steps, run tester-style in one process. This is the
                   tier that pays: one process attaches once and carries the whole
                   sequence, so a run of six steps costs a fraction of six commands.
                   Reach for it whenever the next few steps are already known.
                     prima do "open the account menu" "choose the settings entry" \\
                              "switch the theme to dark" "check the change took effect"
    Never pass a locator or a function expression to do - describe the target.
    Never pass a description to pw - it takes executable code only.
    do stops at the last step you gave it and never carries on past it. A step it could
    not carry out is named under ### Failure and makes the command fail.

  LOOP
    prima go <url|path|words>  reach the page you want to work on
    prima research             once per new page; returns verified locators
    prima pw "..."             drive the page with those locators
    prima verify "..."         assert the outcome (prima ask "..." to inspect instead)
    Fall back to do whenever research left you no locator to hold.

  CHECK
    check runs a whole scenario the way a tester would: it plans, drives the page, and
    verifies the outcome itself, then reports every step with the proof for each.
    Give it an outcome, not a click path - it decides how to get there.
      prima check "a workflow can be created and appears in the list" --url http://app.test
      prima check "signup rejects a duplicate email" --expected "an error names the email as taken" --expected "no second account is created"
    --url  opens that page first, when the browser is not already on it.
    --expected  one outcome the run must reach; repeat it for several. Without it the
                scenario text is the single expected outcome.
    ### Expected outcomes echoes each one back as PASSED, FAILED or not verified -
    "not verified" means the run never checked it, which is not the same as false.
    ### Steps lists what ran; page problems seen on the way are reported separately
    under ### Answer, because they are not step failures.
    Prefer check over do when you want a verdict on a behaviour; prefer do when you
    already know the steps and want them carried out.

  VERIFY
    verify runs the assertions it can express and reports each one with PASSED or
    FAILED, plus the playwright form of the ones that held. It does not decide whether
    your claim is true - read the lines and decide. Assertions that ran are evidence;
    "none ran" means the claim could not be expressed, which is not the same as false.

  ENVELOPE
    ### Result     ok, command, used
    ### Page       url, title, state hash, visit count
    ### Changes    what the accessibility tree gained, lost, toggled or had typed into it
    ### Steps      per-instruction outcome of do, each with the change that proves it
    ### Expected outcomes  each --expected of check, as PASSED, FAILED or not verified
    ### Answer | ### Research | ### Assertions   output of ask, research, verify
    ### Failure    error, compact ARIA of the page
    ### Instance   the browser you are on and the other instances running
    ### Artifacts  paths to the full aria.yml, page.html and network.jsonl
    used: is code that already executed - CodeceptJS steps to copy as they are, except
          for pw, whose Playwright expression a test needs inside I.usePlaywrightTo(...).
    Log lines can precede the envelope; start parsing at the first ### line.

  FAILURE
    A failed action fails. Nothing is retried along a different route and no other
    element is ever substituted for the one you asked for, so ok: true always means
    your own action landed.
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

function addCommonOptions(cmd: Command): Command {
  return cmd
    .option('-v, --verbose', 'Enable verbose logging')
    .option('--debug', 'Enable debug logging (same as --verbose)')
    .option('-c, --config <path>', 'Path to explorbot configuration file')
    .option('-p, --path <path>', 'Working directory path')
    .option('-i, --instance <name>', 'Browser instance to drive')
    .option('--session [file]', 'Persist cookies and storage to a session file')
    .option('--ephemeral', 'Keep no state between runs; applies to config-free runs, where output goes to a temp directory')
    .option('--framework <name>', 'Not active yet: framework the reported code targets, codeceptjs or playwright')
    .option('--url <url>', 'Page to open when the session has no page yet')
    .option('--endpoint <ep>', 'Websocket endpoint of a browser server to attach to, skipping discovery')
    .option('--pw-session <title>', 'Title of the playwright-cli session to attach to');
}

function primaFor(options: any): Prima {
  if (options.ephemeral) process.env.EXPLORBOT_EPHEMERAL = '1';
  return new Prima(buildOptions(options));
}

async function runPrima(options: any, command: string, run: (prima: Prima) => Promise<EnvelopeData>): Promise<void> {
  setQuietMode(!options.verbose && !options.debug);
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

  addCommonOptions(cmd.command('check <scenario>').description('Run a scenario end to end as a test, with its own verification, and report the steps it took'))
    .option('--expected <outcome>', 'An outcome the run must reach; repeat the flag for several', (value: string, all: string[]) => [...all, value], [])
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

  addCommonOptions(cmd.command('go <target>').description('Navigate to a url, a path, or a page described in plain words')).action(async (target, options) => {
    if (URL.canParse(target)) options.baseUrl = target;
    await runPrima(options, `go ${target}`, (prima) => prima.go(target));
  });

  addCommonOptions(cmd.command('status <hash>').description('Show the artifacts and page detail recorded for an earlier command')).action(async (hash, options) => {
    await runPrima(options, `status ${hash}`, (prima) => prima.status(hash));
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
