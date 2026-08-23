import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os, { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from 'ink-testing-library';
import React from 'react';
import InitWizard from '../../src/components/InitWizard.tsx';
import { ApibotConfigParser } from '../../boat/api-tester/src/config.ts';
import { runInit } from '../../src/commands/init-command.ts';
import { ConfigParser } from '../../src/config.ts';
import { listSites, registerSite, resolveSiteTarget, siteFolderName } from '../../src/global-config.ts';

const ENV_KEYS = ['EXPLORBOT_AI_PROVIDER', 'EXPLORBOT_AI_MODEL', 'EXPLORBOT_URL', 'EXPLORBOT_OUTPUT', 'GLOBAL_ONLY_KEY', 'SHARED_KEY'];
const GLOBAL_CONFIG = "export default { ai: { model: { modelId: 'global-model' } } };\n";

let home: string;
let workDir: string;
let savedEnv: Record<string, string | undefined> = {};
let homedirSpy: ReturnType<typeof spyOn>;

function writeGlobalConfig(body = GLOBAL_CONFIG): string {
  const dir = join(home, '.explorbot');
  mkdirSync(dir, { recursive: true });
  const configPath = join(dir, 'config.js');
  writeFileSync(configPath, body, 'utf8');
  return configPath;
}

async function waitForFrame(wizard: ReturnType<typeof render>, text: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (wizard.lastFrame()?.includes(text)) return;
    await Bun.sleep(10);
  }
}

async function typeUntilFrame(wizard: ReturnType<typeof render>, input: string, text: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    wizard.stdin.write(input);
    for (let tick = 0; tick < 10; tick++) {
      if (wizard.lastFrame()?.includes(text)) return;
      await Bun.sleep(10);
    }
  }
}

function siteDir(folder: string): string {
  return join(home, '.explorbot', 'sites', folder);
}

beforeEach(() => {
  savedEnv = { HOME: process.env.HOME };
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }

  home = mkdtempSync(join(tmpdir(), 'explorbot-home-'));
  workDir = mkdtempSync(join(tmpdir(), 'explorbot-work-'));
  process.env.HOME = home;
  homedirSpy = spyOn(os, 'homedir').mockReturnValue(home);
  ConfigParser.resetForTesting();
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  homedirSpy.mockRestore();
  rmSync(home, { recursive: true, force: true });
  rmSync(workDir, { recursive: true, force: true });
  ConfigParser.resetForTesting();
});

describe('site folder names', () => {
  it('derives the folder from host and port', () => {
    expect(siteFolderName('http://localhost:3000/login')).toBe('localhost_3000');
    expect(siteFolderName('https://app.example.com/login')).toBe('app.example.com');
  });

  it('lowercases the host and replaces characters invalid in directory names', () => {
    expect(siteFolderName('https://APP.Example.COM')).toBe('app.example.com');
    expect(siteFolderName('http://127.0.0.1:8080')).toBe('127.0.0.1_8080');
  });
});

describe('site registration', () => {
  it('creates the site folder, meta file, and subdirectories once', () => {
    const site = registerSite('https://app.example.com');

    expect(site.dir).toBe(siteDir('app.example.com'));
    for (const subDir of ['knowledge', 'experience', 'output']) {
      expect(existsSync(join(site.dir, subDir))).toBe(true);
    }
    expect(JSON.parse(readFileSync(join(site.dir, 'site.json'), 'utf8')).url).toBe('https://app.example.com');
  });

  it('keeps createdAt and updates lastRunAt on later runs', async () => {
    const first = registerSite('https://app.example.com');
    await Bun.sleep(2);
    const second = registerSite('https://app.example.com');

    expect(second.createdAt).toBe(first.createdAt);
    expect(second.lastRunAt > first.lastRunAt).toBe(true);
    expect(listSites().length).toBe(1);
  });
});

describe('site target resolution', () => {
  it('splits an absolute URL into base URL and path', () => {
    expect(resolveSiteTarget('https://app.example.com/login?next=1')).toEqual({
      baseUrl: 'https://app.example.com',
      path: '/login?next=1',
    });
  });

  it('resolves a bare reference by folder name and by host', () => {
    registerSite('http://localhost:3000');

    expect(resolveSiteTarget('localhost_3000/login')).toEqual({ baseUrl: 'http://localhost:3000', path: '/login' });
    expect(resolveSiteTarget('localhost:3000')).toEqual({ baseUrl: 'http://localhost:3000', path: '/' });
  });

  it('lists registered sites when the reference is unknown', () => {
    registerSite('https://app.example.com');

    expect(() => resolveSiteTarget('other.example.com/login')).toThrow(/Unknown site "other.example.com"/);
    expect(() => resolveSiteTarget('other.example.com/login')).toThrow(/app.example.com/);
  });

  it('resolves a leading-slash path against EXPLORBOT_URL', () => {
    process.env.EXPLORBOT_URL = 'https://app.example.com';

    expect(resolveSiteTarget('/login')).toEqual({ baseUrl: 'https://app.example.com', path: '/login' });
  });

  it('rejects a leading-slash path when no base URL is known', () => {
    registerSite('https://app.example.com');

    expect(() => resolveSiteTarget('/login')).toThrow(/Cannot resolve path/);
  });
});

describe('config resolution ladder', () => {
  it('prefers a project config over the global one', async () => {
    writeGlobalConfig();
    writeFileSync(join(workDir, 'explorbot.config.js'), "export default { playwright: { browser: 'chromium', url: 'https://project.example.com' }, ai: { model: { modelId: 'project-model' } } };\n", 'utf8');

    const config = await ConfigParser.getInstance().loadConfig({ path: workDir });

    expect(config.ai.model.modelId).toBe('project-model');
    expect(ConfigParser.getInstance().isGlobalMode()).toBe(false);
  });

  it('prefers EXPLORBOT_ environment variables over the global config', async () => {
    const parser = ConfigParser.getInstance();
    writeGlobalConfig();
    process.env.EXPLORBOT_AI_PROVIDER = 'openrouter';
    process.env.EXPLORBOT_URL = 'https://env.example.com';

    const config = await parser.loadConfig({ path: workDir });

    expect(config.ai.model.modelId).toBe(ConfigParser.recommendedModels().openrouter.model);
    expect(config.playwright.url).toBe('https://env.example.com');
    expect(parser.isGlobalMode()).toBe(false);
  });

  it('prefers a project config over EXPLORBOT_ environment variables', async () => {
    writeGlobalConfig();
    writeFileSync(join(workDir, 'explorbot.config.js'), "export default { playwright: { browser: 'chromium', url: 'https://project.example.com' }, ai: { model: { modelId: 'project-model' } } };\n", 'utf8');
    process.env.EXPLORBOT_AI_PROVIDER = 'openrouter';
    process.env.EXPLORBOT_URL = 'https://env.example.com';

    const config = await ConfigParser.getInstance().loadConfig({ path: workDir });

    expect(config.ai.model.modelId).toBe('project-model');
  });

  it('takes the env-mode URL from an absolute command target', async () => {
    writeGlobalConfig();
    process.env.EXPLORBOT_AI_PROVIDER = 'openrouter';

    const config = await ConfigParser.getInstance().loadConfig({ path: workDir, from: 'https://from-argument.example.com/login' });

    expect(config.playwright.url).toBe('https://from-argument.example.com/login');
  });

  it('suggests init --global when no configuration is found at all', async () => {
    await expect(ConfigParser.getInstance().loadConfig({ path: workDir })).rejects.toThrow(/init --global/);
  });

  it('turns "provider/model-id" model specs into models', async () => {
    writeGlobalConfig("export default { ai: { model: 'groq/openai/gpt-oss-20b', agenticModel: 'openrouter', agents: { tester: { model: 'groq/qwen/qwen3-32b' } } } };\n");

    const config = await ConfigParser.getInstance().loadConfig({ path: workDir, from: 'https://app.example.com' });

    expect(config.ai.model.modelId).toBe('openai/gpt-oss-20b');
    expect(config.ai.agenticModel.modelId).toBe(ConfigParser.recommendedModels().openrouter.agenticModel);
    expect(config.ai.agents!.tester!.model.modelId).toBe('qwen/qwen3-32b');
  });
});

describe('env file loading', () => {
  it('loads the global env file', async () => {
    writeGlobalConfig();
    writeFileSync(join(home, '.explorbot', '.env'), 'GLOBAL_ONLY_KEY=from-global\n', 'utf8');

    await ConfigParser.getInstance().loadConfig({ path: workDir, from: 'https://app.example.com' });

    expect(process.env.GLOBAL_ONLY_KEY).toBe('from-global');
  });

  it('lets the working directory env file override the global one', async () => {
    writeGlobalConfig();
    writeFileSync(join(home, '.explorbot', '.env'), 'SHARED_KEY=from-global\n', 'utf8');
    writeFileSync(join(workDir, '.env'), 'SHARED_KEY=from-cwd\n', 'utf8');

    await ConfigParser.getInstance().loadConfig({ path: workDir, from: 'https://app.example.com' });

    expect(process.env.SHARED_KEY).toBe('from-cwd');
  });
});

describe('global mode', () => {
  it('stores knowledge, experience, and output under the site folder', async () => {
    const parser = ConfigParser.getInstance();
    writeGlobalConfig();

    const config = await parser.loadConfig({ path: workDir, from: 'https://app.example.com/login' });

    expect(parser.isGlobalMode()).toBe(true);
    expect(parser.getProjectRoot()).toBe(siteDir('app.example.com'));
    expect(parser.getOutputDir()).toBe(join(siteDir('app.example.com'), 'output'));
    expect(parser.resolveProjectDir(config.dirs!.knowledge)).toBe(join(siteDir('app.example.com'), 'knowledge'));
    expect(parser.resolveProjectDir(config.dirs!.experience)).toBe(join(siteDir('app.example.com'), 'experience'));
    expect(config.playwright.url).toBe('https://app.example.com');
  });

  it('registers the site and updates lastRunAt on every run', async () => {
    const parser = ConfigParser.getInstance();
    writeGlobalConfig();

    await parser.loadConfig({ path: workDir, from: 'https://app.example.com/login' });
    const first = listSites()[0];

    ConfigParser.resetForTesting();
    await Bun.sleep(2);
    await ConfigParser.getInstance().loadConfig({ path: workDir, from: 'app.example.com/dashboard' });
    const second = listSites()[0];

    expect(listSites().length).toBe(1);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.lastRunAt > first.lastRunAt).toBe(true);
  });

  it('ignores a dirs section in the global config', async () => {
    const parser = ConfigParser.getInstance();
    writeGlobalConfig("export default { ai: { model: { modelId: 'global-model' } }, dirs: { knowledge: 'kb', experience: 'exp', output: 'out' } };\n");

    const config = await parser.loadConfig({ path: workDir, from: 'https://app.example.com' });

    expect(config.dirs).toEqual({ knowledge: 'knowledge', experience: 'experience', output: 'output' });
    expect(parser.getOutputDir()).toBe(join(siteDir('app.example.com'), 'output'));
  });

  it('falls back to a URL pinned in the global config when the command passes none', async () => {
    const parser = ConfigParser.getInstance();
    writeGlobalConfig("export default { web: { url: 'https://pinned.example.com' }, ai: { model: { modelId: 'global-model' } } };\n");

    const config = await parser.loadConfig({ path: workDir });

    expect(config.playwright.url).toBe('https://pinned.example.com');
    expect(parser.getProjectRoot()).toBe(siteDir('pinned.example.com'));
  });

  it('lets the command URL win over a URL pinned in the global config', async () => {
    const parser = ConfigParser.getInstance();
    writeGlobalConfig("export default { web: { url: 'https://pinned.example.com' }, ai: { model: { modelId: 'global-model' } } };\n");

    const config = await parser.loadConfig({ path: workDir, from: 'https://asked.example.com/login' });

    expect(config.playwright.url).toBe('https://asked.example.com');
    expect(parser.getProjectRoot()).toBe(siteDir('asked.example.com'));
  });

  it('keeps the fragment of a hash-routed URL', () => {
    expect(resolveSiteTarget('https://app.example.com/#/login')).toEqual({
      baseUrl: 'https://app.example.com',
      path: '/#/login',
    });
  });

  it('errors with the registered sites when no site is given', async () => {
    writeGlobalConfig();
    registerSite('https://app.example.com');

    await expect(ConfigParser.getInstance().loadConfig({ path: workDir })).rejects.toThrow(/app.example.com/);
  });

  it('turns command targets into paths within the site', async () => {
    const parser = ConfigParser.getInstance();
    writeGlobalConfig();

    await parser.loadConfig({ path: workDir, from: 'https://app.example.com/login' });

    expect(parser.resolveTargetPath()).toBe('/login');
    expect(parser.resolveTargetPath('/dashboard')).toBe('/dashboard');
    expect(parser.resolveTargetPath('https://app.example.com/settings')).toBe('/settings');
    expect(parser.resolveTargetPath('app.example.com/users')).toBe('/users');
  });

  it('keeps targets outside the site untouched', async () => {
    const parser = ConfigParser.getInstance();
    writeGlobalConfig();

    await parser.loadConfig({ path: workDir, from: 'https://app.example.com' });

    expect(parser.resolveTargetPath('https://other.example.com/login')).toBe('https://other.example.com/login');
  });
});

describe('global mode in the API boat', () => {
  it('derives the base endpoint and site folder from the endpoint host', async () => {
    writeGlobalConfig();
    const parser = ApibotConfigParser.getInstance();
    (parser as any).config = null;
    (parser as any).configPath = null;
    (parser as any).site = null;

    const config = await parser.loadConfig({ path: workDir, endpoint: 'https://api.example.com/users' });

    expect(config.api.baseEndpoint).toBe('https://api.example.com');
    expect(parser.getOutputDir()).toBe(join(siteDir('api.example.com'), 'output'));
    expect(parser.getKnowledgeDir()).toBe(join(siteDir('api.example.com'), 'knowledge'));
    expect(parser.resolveEndpointPath('https://api.example.com/users')).toBe('/users');

    (parser as any).config = null;
    (parser as any).configPath = null;
    (parser as any).site = null;
  });
});

describe('explorbot init', () => {
  it('writes the global config and env file without the wizard', async () => {
    await runInit({ global: true, provider: 'groq', apiKey: 'test-key' });

    const config = readFileSync(join(home, '.explorbot', 'config.js'), 'utf8');
    expect(config).toContain(`model: 'groq/${ConfigParser.recommendedModels().groq.model}'`);
    expect(config).not.toContain('web:');
    expect(config).not.toContain('dirs:');
    expect(readFileSync(join(home, '.explorbot', '.env'), 'utf8')).toContain('GROQ_API_KEY=test-key');
  });

  it('refuses to overwrite an existing global config without --force and keeps the stored key', async () => {
    await runInit({ global: true, provider: 'groq', apiKey: 'first-key' });

    const originalExit = process.exit;
    (process as any).exit = (code?: number) => {
      throw new Error(`exit:${code}`);
    };

    try {
      await expect(runInit({ global: true, provider: 'openai' })).rejects.toThrow('exit:1');
      expect(readFileSync(join(home, '.explorbot', 'config.js'), 'utf8')).toContain("model: 'groq/");

      await runInit({ global: true, provider: 'groq', force: true });
      expect(readFileSync(join(home, '.explorbot', 'config.js'), 'utf8')).toContain("model: 'groq/");
      expect(readFileSync(join(home, '.explorbot', '.env'), 'utf8')).toContain('GROQ_API_KEY=first-key');
    } finally {
      (process as any).exit = originalExit;
    }
  });

  it('never renders the API key in clear text', async () => {
    const noop = () => {};
    const wizard = render(React.createElement(InitWizard, { mode: 'global', globalConfigExists: false, onLocal: noop, onComplete: noop, onCancel: noop }));

    wizard.stdin.write('\r');
    await waitForFrame(wizard, 'Enter the API key');
    await typeUntilFrame(wizard, 'sk-secret-value', '•');

    expect(wizard.lastFrame()).toContain('Enter the API key');
    expect(wizard.lastFrame()).not.toContain('sk-secret-value');
    expect(wizard.lastFrame()).toContain('•');
  });

  it('offers both installations and marks global as installed', () => {
    const noop = () => {};
    const chooser = render(React.createElement(InitWizard, { mode: 'choose', globalConfigExists: true, onLocal: noop, onComplete: noop, onCancel: noop }));
    expect(chooser.lastFrame()).toContain('Local');
    expect(chooser.lastFrame()).toContain('(already installed)');

    const wizard = render(React.createElement(InitWizard, { mode: 'global', globalConfigExists: false, onLocal: noop, onComplete: noop, onCancel: noop }));
    expect(wizard.lastFrame()).toContain('Pick an AI provider');
    expect(wizard.lastFrame()).not.toContain('(already installed)');
  });

  it('falls back to the local flow outside an interactive terminal', async () => {
    const originalCwd = process.cwd();
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    process.chdir(workDir);

    try {
      await runInit({});
      expect(existsSync(join(workDir, 'explorbot.config.js'))).toBe(true);
      expect(existsSync(join(home, '.explorbot', 'config.js'))).toBe(false);
    } finally {
      process.chdir(originalCwd);
      Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
    }
  });
});
