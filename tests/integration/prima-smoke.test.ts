import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type Browser, chromium } from 'playwright';
import { renderEnvelope } from '../../boat/prima/src/envelope.ts';
import { Prima } from '../../boat/prima/src/prima.ts';
import { readDescriptors, registryDir, selectDescriptor } from '../../boat/prima/src/pw-registry.ts';
import { ConfigParser } from '../../src/config.ts';

const PRIMA_CLI = path.join(process.cwd(), 'boat', 'prima', 'bin', 'prima-cli.ts');

const FEEDBACK_PAGE = `<!doctype html>
<html>
  <head><title>Widget Depot Feedback</title></head>
  <body>
    <h1>Send feedback</h1>
    <form action="/thanks" method="get">
      <label for="note">Your message</label>
      <input id="note" name="note" type="text" />
      <button type="submit">Submit</button>
    </form>
  </body>
</html>`;

const THANKS_PAGE = `<!doctype html>
<html>
  <head><title>Widget Depot Thanks</title></head>
  <body><h1>Thanks for the note</h1></body>
</html>`;

function startFixtureServer() {
  return Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === '/thanks') return new Response(THANKS_PAGE, { headers: { 'content-type': 'text/html' } });
      return new Response(FEEDBACK_PAGE, { headers: { 'content-type': 'text/html' } });
    },
  });
}

function writeDescriptor(dir: string, title: string) {
  mkdirSync(dir, { recursive: true });
  const descriptor = {
    playwrightVersion: '1.62.0',
    playwrightLib: '',
    title,
    endpoint: 'ws://127.0.0.1:1/smoke-session',
    workspaceDir: process.cwd(),
    browser: { browserName: 'chromium', guid: 'smoke-guid' },
  };
  writeFileSync(path.join(dir, 'smoke-guid'), JSON.stringify(descriptor), 'utf8');
}

const liveSession = selectDescriptor(readDescriptors(), { workspaceDir: process.cwd() }).match;

describe('Prima drives a real page', () => {
  let server: ReturnType<typeof startFixtureServer>;
  let browser: Browser;
  let prima: Prima;
  let home: string;
  let base: string;
  const realHome = process.env.HOME;
  const realCache = process.env.XDG_CACHE_HOME;

  beforeAll(async () => {
    server = startFixtureServer();
    base = `http://127.0.0.1:${server.port}`;

    home = mkdtempSync(path.join(tmpdir(), 'prima-smoke-'));
    process.env.HOME = home;
    process.env.XDG_CACHE_HOME = path.join(home, '.cache');
    writeDescriptor(registryDir(), 'default');

    ConfigParser.resetForTesting();
    ConfigParser.setupTestConfig();

    browser = await chromium.launch({ headless: true });
    prima = new Prima({ instance: 'default' });
    (prima as any).connectDescriptor = async () => browser;
    await prima.start();
  });

  beforeEach(async () => {
    await prima.go(`${base}/`);
  });

  afterAll(async () => {
    await prima?.stop().catch(() => {});
    await browser?.close().catch(() => {});
    server?.stop(true);
    process.env.HOME = realHome;
    process.env.XDG_CACHE_HOME = realCache;
    rmSync(home, { recursive: true, force: true });
    ConfigParser.cleanupAllTestDirectories();
  });

  test('attaches to the workspace session instead of launching a browser', async () => {
    const info = await prima.instanceInfo();
    expect(info.attached).toContain('default');
    expect(info.attached).toContain(process.cwd());
    expect(existsSync(path.join(home, '.explorbot'))).toBe(false);
  });

  test('pw clicks the fixture form and reports the page change', async () => {
    const envelope = await prima.pw("({ page }) => page.click('text=Submit')");

    expect(envelope.ok).toBe(true);
    expect(envelope.used).toEqual(["({ page }) => page.click('text=Submit')"]);
    expect(envelope.page.title).toBe('Widget Depot Thanks');
    expect(envelope.page.previousUrl).not.toBe(envelope.page.url);
    expect(envelope.changes).toContain('Submit');

    const rendered = renderEnvelope(envelope);
    expect(rendered).toContain('### Changes');
    expect(rendered).toContain('### Instance');
  });

  test('pw runs a multi-line function without losing any of its lines', async () => {
    const expression = ['async ({ page }) => {', "  await page.fill('#note', 'the hinge arrived bent');", "  await page.click('text=Submit');", '}'].join('\n');

    const envelope = await prima.pw(expression);

    expect(envelope.ok).toBe(true);
    expect(envelope.page.title).toBe('Widget Depot Thanks');
    expect(envelope.page.url).toContain('note=the+hinge+arrived+bent');
  });

  test('pw writes the aria, html and network artifacts to disk', async () => {
    const envelope = await prima.pw("({ page }) => page.click('text=Submit')");

    expect(existsSync(envelope.artifacts!.aria)).toBe(true);
    expect(existsSync(envelope.artifacts!.html)).toBe(true);
    expect(existsSync(envelope.artifacts!.network)).toBe(true);
    expect(await Bun.file(envelope.artifacts!.aria).text()).toContain('Thanks for the note');
    expect(await Bun.file(envelope.artifacts!.html).text()).toContain('Thanks for the note');
  });

  test('a non-function argument is a tool error and leaves the page alone', async () => {
    const envelope = await prima.pw("page.click('text=Submit')");

    expect(envelope.ok).toBe(false);
    expect(envelope.failure?.error).toStartWith('tool:');
    expect(envelope.failure?.compactAria).toContain('button "Submit"');
    expect(envelope.artifacts).toBeUndefined();

    const page = browser.contexts()[0].pages().at(-1)!;
    expect(await page.title()).toBe('Widget Depot Feedback');
  });

  test('a failing pw without a usable AI model reports healing as unavailable', async () => {
    const envelope = await prima.pw("({ page }) => page.click('text=Ship the order')");

    expect(envelope.ok).toBe(false);
    expect(envelope.healed).toBe(false);
    expect(envelope.healNote).toContain('ai unavailable');
    expect(envelope.failure?.compactAria).toContain('button "Submit"');
  });
});

describe('Prima without a browser session', () => {
  let workspace: string;

  beforeAll(() => {
    workspace = mkdtempSync(path.join(tmpdir(), 'prima-workspace-'));
    mkdirSync(path.join(workspace, 'home', '.cache'), { recursive: true });
    writeFileSync(
      path.join(workspace, 'explorbot.config.js'),
      `export default {
  playwright: { browser: 'chromium', url: 'http://127.0.0.1:9', show: false },
  ai: { model: null },
  dirs: { output: 'output' },
};
`,
      'utf8'
    );
  });

  afterAll(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  test('the cli fails with session guidance, exits 1 and creates no endpoint', async () => {
    const home = path.join(workspace, 'home');
    const run = Bun.spawnSync(['bun', PRIMA_CLI, 'pw', "({ page }) => page.click('text=Submit')"], {
      cwd: workspace,
      env: { ...process.env, HOME: home, XDG_CACHE_HOME: path.join(home, '.cache') },
    });

    const stdout = run.stdout.toString();
    expect(run.exitCode).toBe(1);
    expect(stdout).toContain('ok: false');
    expect(stdout).toContain('playwright-cli open');
    expect(stdout).toContain('prima browser start');
    expect(existsSync(path.join(workspace, 'output', '.browser-endpoint'))).toBe(false);
  }, 60000);
});

describe('Prima without a config file', () => {
  let workspace: string;
  let home: string;

  beforeAll(() => {
    workspace = mkdtempSync(path.join(tmpdir(), 'prima-config-free-'));
    home = path.join(workspace, 'home');
    mkdirSync(path.join(home, '.cache'), { recursive: true });
  });

  afterAll(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  function runCli(args: string[]) {
    const env: Record<string, string> = { ...process.env, HOME: home, XDG_CACHE_HOME: path.join(home, '.cache'), EXPLORBOT_AI_PROVIDER: 'groq' };
    for (const key of ['EXPLORBOT_URL', 'EXPLORBOT_AI_MODEL', 'EXPLORBOT_OUTPUT', 'EXPLORBOT_EPHEMERAL']) delete env[key];

    const run = Bun.spawnSync(['bun', PRIMA_CLI, ...args], { cwd: workspace, env });
    return { exitCode: run.exitCode, stdout: run.stdout.toString() };
  }

  test('the go target is the url the configuration is built around', () => {
    const run = runCli(['go', 'https://app.example.com/login']);

    expect(run.stdout).not.toContain('No URL to explore');
    expect(run.stdout).toContain('playwright-cli open');
    expect(run.exitCode).toBe(1);
    expect(existsSync(path.join(home, '.explorbot', 'state', 'app.example.com'))).toBe(true);
  }, 60000);

  test('--url is the url the configuration is built around', () => {
    const run = runCli(['pw', "({ page }) => page.click('text=Submit')", '--url', 'https://shop.example.com']);

    expect(run.stdout).not.toContain('No URL to explore');
    expect(run.stdout).toContain('playwright-cli open');
    expect(run.exitCode).toBe(1);
    expect(existsSync(path.join(home, '.explorbot', 'state', 'shop.example.com'))).toBe(true);
  }, 60000);
});

describe('Prima attaches to a live playwright-cli session', () => {
  test.skipIf(!liveSession)(
    'reports the playwright-cli session it is driving — skipped unless a playwright-cli session is open for this workspace',
    async () => {
      ConfigParser.resetForTesting();
      ConfigParser.setupTestConfig();

      const prima = new Prima({ instance: 'default' });
      await prima.start();

      const info = await prima.instanceInfo();
      expect(info.attached).toContain(liveSession!.title);
      expect(info.tabs).toBeGreaterThan(0);

      await prima.stop();
      expect(readDescriptors().some((descriptor) => descriptor.endpoint === liveSession!.endpoint)).toBe(true);
      expect(await prima.browserStop()).toBe(false);

      ConfigParser.cleanupAllTestDirectories();
    },
    60000
  );
});
