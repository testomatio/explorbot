import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigParser, resolveStateRoot } from '../../src/config.ts';

const KNOWLEDGE_ENV = 'EXPLORBOT_KNOWLEDGE';
const KNOWLEDGE_FILE_ENV = 'EXPLORBOT_KNOWLEDGE_FILE';
const ENV_KEYS = ['EXPLORBOT_AI_PROVIDER', 'EXPLORBOT_AI_MODEL', 'EXPLORBOT_URL', 'EXPLORBOT_OUTPUT', 'EXPLORBOT_EPHEMERAL', KNOWLEDGE_ENV, KNOWLEDGE_FILE_ENV, 'LADDER_SHARED_KEY', 'LADDER_GLOBAL_KEY', 'LADDER_PRESET_KEY'];

const CONFIG_MODULE = (url: string) => `export default {\n  playwright: { url: '${url}', browser: 'chromium' },\n  ai: { model: { modelId: 'ladder-model', provider: 'test' } },\n};\n`;

let home: string;
let project: string;
let savedEnv: Record<string, string | undefined>;
let homedirSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  home = mkdtempSync(path.join(os.tmpdir(), 'explorbot-home-'));
  project = mkdtempSync(path.join(os.tmpdir(), 'explorbot-project-'));
  homedirSpy = spyOn(os, 'homedir').mockReturnValue(home);

  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }

  ConfigParser.resetForTesting();
});

afterEach(() => {
  homedirSpy.mockRestore();
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  rmSync(home, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
  ConfigParser.resetForTesting();
});

function writeGlobalFile(name: string, content: string): string {
  const dir = path.join(home, '.explorbot');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  writeFileSync(file, content);
  return file;
}

describe('resolveStateRoot', () => {
  test('derives persistent per-host dir', () => {
    const dir = resolveStateRoot('https://app.example.com/login');
    expect(dir).toBe(path.join(os.homedir(), '.explorbot', 'state', 'app.example.com'));
    expect(existsSync(dir)).toBe(true);
  });

  test('keeps the port as part of the host, in a name every filesystem accepts', () => {
    const dir = resolveStateRoot('http://localhost:3000/');

    expect(dir).toBe(path.join(home, '.explorbot', 'state', 'localhost_3000'));
    expect(existsSync(dir)).toBe(true);
  });

  test('separates hosts that differ only by port', () => {
    expect(resolveStateRoot('http://localhost:3000/')).not.toBe(resolveStateRoot('http://localhost:4000/'));
  });

  test('falls back to a temp dir when the url has no scheme', () => {
    const dir = resolveStateRoot('example.com');

    expect(dir.startsWith(home)).toBe(false);
    expect(existsSync(dir)).toBe(true);
    expect(existsSync(path.join(home, '.explorbot', 'state'))).toBe(false);
  });

  test('falls back to a temp dir when the url has no host', () => {
    const dir = resolveStateRoot('localhost:3000');

    expect(dir.startsWith(home)).toBe(false);
    expect(existsSync(path.join(home, '.explorbot', 'state'))).toBe(false);
  });

  test('ephemeral returns fresh temp dir', () => {
    const a = resolveStateRoot('https://app.example.com', true);
    const b = resolveStateRoot('https://app.example.com', true);
    expect(a).not.toBe(b);
    expect(a).toContain('explorbot');
    expect(a.startsWith(home)).toBe(false);
    expect(existsSync(a)).toBe(true);
  });
});

describe('config ladder', () => {
  test('loads the global config when the project has none', async () => {
    writeGlobalFile('config.js', CONFIG_MODULE('https://global.example.com'));

    const parser = ConfigParser.getInstance();
    const config = await parser.loadConfig({ path: project });

    expect(config.playwright.url).toBe('https://global.example.com');
    expect(parser.getConfigPath()).toBe(path.join(home, '.explorbot', 'config.js'));
  });

  test('loads a global typescript config', async () => {
    writeGlobalFile('config.ts', CONFIG_MODULE('https://global-ts.example.com'));

    const config = await ConfigParser.getInstance().loadConfig({ path: project });

    expect(config.playwright.url).toBe('https://global-ts.example.com');
  });

  test('prefers the project config over the global one', async () => {
    writeGlobalFile('config.js', CONFIG_MODULE('https://global.example.com'));
    writeFileSync(path.join(project, 'explorbot.config.js'), CONFIG_MODULE('https://project.example.com'));

    const parser = ConfigParser.getInstance();
    const config = await parser.loadConfig({ path: project });

    expect(config.playwright.url).toBe('https://project.example.com');
    expect(parser.getConfigPath()).toBe(path.join(project, 'explorbot.config.js'));
  });

  test('prefers an explicit config path over the global one', async () => {
    writeGlobalFile('config.js', CONFIG_MODULE('https://global.example.com'));
    const explicit = path.join(project, 'custom.config.js');
    writeFileSync(explicit, CONFIG_MODULE('https://explicit.example.com'));

    const config = await ConfigParser.getInstance().loadConfig({ config: explicit });

    expect(config.playwright.url).toBe('https://explicit.example.com');
  });
});

describe('global .env', () => {
  test('fills keys the project .env and the environment leave unset', async () => {
    writeGlobalFile('config.js', CONFIG_MODULE('https://global.example.com'));
    writeGlobalFile('.env', 'LADDER_GLOBAL_KEY=from-global\nLADDER_SHARED_KEY=from-global\nLADDER_PRESET_KEY=from-global\n');
    writeFileSync(path.join(project, '.env'), 'LADDER_SHARED_KEY=from-project\n');
    process.env.LADDER_PRESET_KEY = 'from-environment';

    await ConfigParser.getInstance().loadConfig({ path: project });

    expect(process.env.LADDER_GLOBAL_KEY).toBe('from-global');
    expect(process.env.LADDER_SHARED_KEY).toBe('from-project');
    expect(process.env.LADDER_PRESET_KEY).toBe('from-environment');
  });
});

describe('config-free state root', () => {
  test('roots knowledge, experience and output under the per-host state dir', async () => {
    process.env.EXPLORBOT_AI_MODEL = 'openrouter/openai/gpt-oss-120b';
    process.env.EXPLORBOT_URL = 'https://app.example.com';

    const parser = ConfigParser.getInstance();
    const config = await parser.loadConfig({ path: project });
    const stateRoot = path.join(home, '.explorbot', 'state', 'app.example.com');

    expect(parser.getOutputDir()).toBe(stateRoot);
    expect(parser.resolveProjectDir(config.dirs!.knowledge)).toBe(path.join(stateRoot, 'knowledge'));
    expect(parser.resolveProjectDir(config.dirs!.experience)).toBe(path.join(stateRoot, 'experience'));
  });

  test('uses a temp state root when EXPLORBOT_EPHEMERAL is set', async () => {
    process.env.EXPLORBOT_AI_MODEL = 'openrouter/openai/gpt-oss-120b';
    process.env.EXPLORBOT_URL = 'https://app.example.com';
    process.env.EXPLORBOT_EPHEMERAL = '1';

    const parser = ConfigParser.getInstance();
    await parser.loadConfig({ path: project });

    expect(parser.getOutputDir().startsWith(home)).toBe(false);
    expect(parser.getOutputDir()).toContain('explorbot');
  });

  test('records experience while the state root is persistent', async () => {
    process.env.EXPLORBOT_AI_MODEL = 'openrouter/openai/gpt-oss-120b';
    process.env.EXPLORBOT_URL = 'https://app.example.com';

    const config = await ConfigParser.getInstance().loadConfig({ path: project });

    expect(config.experience?.disabled).toBe(false);
  });

  test('records no experience when the state root is ephemeral', async () => {
    process.env.EXPLORBOT_AI_MODEL = 'openrouter/openai/gpt-oss-120b';
    process.env.EXPLORBOT_URL = 'https://app.example.com';
    process.env.EXPLORBOT_EPHEMERAL = '1';

    const config = await ConfigParser.getInstance().loadConfig({ path: project });

    expect(config.experience?.disabled).toBe(true);
  });

  test('leaves an unparseable url to config validation', async () => {
    process.env.EXPLORBOT_AI_MODEL = 'openrouter/openai/gpt-oss-120b';
    process.env.EXPLORBOT_URL = 'example.com';

    const parser = ConfigParser.getInstance();
    const config = await parser.loadConfig({ path: project });

    expect(parser.getOutputDir().startsWith(home)).toBe(false);
    expect(() => parser.validateConfig(config)).toThrow(/Invalid URL in configuration: example.com/);
  });

  test('keeps EXPLORBOT_OUTPUT ahead of the state dir', async () => {
    process.env.EXPLORBOT_AI_MODEL = 'openrouter/openai/gpt-oss-120b';
    process.env.EXPLORBOT_URL = 'https://app.example.com';
    process.env.EXPLORBOT_OUTPUT = project;

    const parser = ConfigParser.getInstance();
    await parser.loadConfig({ path: project });

    expect(parser.getOutputDir()).toBe(project);
  });

  test('keeps env knowledge per run and leaves authored files alone', async () => {
    process.env.EXPLORBOT_AI_MODEL = 'openrouter/openai/gpt-oss-120b';
    process.env.EXPLORBOT_URL = 'https://app.example.com';
    process.env[KNOWLEDGE_ENV] = 'Credentials: admin/admin123';

    const parser = ConfigParser.getInstance();
    await parser.loadConfig({ path: project });

    const knowledgeDir = path.join(home, '.explorbot', 'state', 'app.example.com', 'knowledge');
    const globalFile = path.join(knowledgeDir, 'global.md');
    expect(existsSync(globalFile)).toBe(true);

    const authored = path.join(knowledgeDir, 'login.md');
    writeFileSync(authored, '---\nurl: /login\n---\n\nAuthored by hand\n');

    delete process.env[KNOWLEDGE_ENV];
    ConfigParser.resetForTesting();
    await ConfigParser.getInstance().loadConfig({ path: project });

    expect(existsSync(globalFile)).toBe(false);
    expect(existsSync(authored)).toBe(true);
  });

  test('drops a knowledge file of an earlier run and leaves authored files alone', async () => {
    process.env.EXPLORBOT_AI_MODEL = 'openrouter/openai/gpt-oss-120b';
    process.env.EXPLORBOT_URL = 'https://app.example.com';

    const first = path.join(project, 'staging.md');
    writeFileSync(first, '---\nurl: /login\n---\n\nCredentials: admin/admin123\n');
    process.env[KNOWLEDGE_FILE_ENV] = first;

    const parser = ConfigParser.getInstance();
    await parser.loadConfig({ path: project });

    const knowledgeDir = path.join(home, '.explorbot', 'state', 'app.example.com', 'knowledge');
    expect(existsSync(path.join(knowledgeDir, 'env', 'staging.md'))).toBe(true);

    const authored = path.join(knowledgeDir, 'checkout.md');
    writeFileSync(authored, '---\nurl: /checkout\n---\n\nAuthored by hand\n');

    const second = path.join(project, 'production.md');
    writeFileSync(second, '---\nurl: /login\n---\n\nCredentials: guest/guest\n');
    process.env[KNOWLEDGE_FILE_ENV] = second;
    ConfigParser.resetForTesting();
    await ConfigParser.getInstance().loadConfig({ path: project });

    expect(existsSync(path.join(knowledgeDir, 'env', 'staging.md'))).toBe(false);
    expect(existsSync(path.join(knowledgeDir, 'env', 'production.md'))).toBe(true);
    expect(existsSync(authored)).toBe(true);

    delete process.env[KNOWLEDGE_FILE_ENV];
    ConfigParser.resetForTesting();
    await ConfigParser.getInstance().loadConfig({ path: project });

    expect(existsSync(path.join(knowledgeDir, 'env'))).toBe(false);
    expect(existsSync(authored)).toBe(true);
  });
});
