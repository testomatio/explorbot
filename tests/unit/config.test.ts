import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigParser, EXPLORBOT_ENV_VARS, materializeKnowledge, resolveModel, resolveOutputRoot } from '../../src/config.ts';

describe('ConfigParser runtime baseUrl overrides', () => {
  beforeEach(() => {
    ConfigParser.resetForTesting();
  });

  it('reloads config when runtime baseUrl override changes', async () => {
    const parser = ConfigParser.getInstance();
    const originalLoadConfigModule = (parser as any).loadConfigModule;
    const originalFindConfigFile = (parser as any).findConfigFile;

    (parser as any).findConfigFile = () => '/virtual/explorbot.config.ts';
    (parser as any).loadConfigModule = async () => ({
      default: {
        playwright: {
          url: 'https://default.example.com',
          browser: 'chromium',
        },
        ai: {
          model: { modelId: 'test-model', provider: 'test' },
          config: {},
        },
      },
    });

    try {
      const first = await parser.loadConfig({ baseUrl: 'https://one.example.com' });
      const second = await parser.loadConfig({ baseUrl: 'https://two.example.com' });
      const fallback = await parser.loadConfig();

      expect(first.playwright.url).toBe('https://one.example.com');
      expect(second.playwright.url).toBe('https://two.example.com');
      expect(fallback.playwright.url).toBe('https://default.example.com');
    } finally {
      (parser as any).loadConfigModule = originalLoadConfigModule;
      (parser as any).findConfigFile = originalFindConfigFile;
      ConfigParser.resetForTesting();
    }
  });
});

const ENV_KEYS = ['EXPLORBOT_AI_PROVIDER', 'EXPLORBOT_AI_MODEL', 'EXPLORBOT_VISION_MODEL', 'EXPLORBOT_AGENTIC_MODEL', 'EXPLORBOT_URL', 'EXPLORBOT_OUTPUT', 'EXPLORBOT_KNOWLEDGE', 'EXPLORBOT_KNOWLEDGE_FILE'];

let savedEnv: Record<string, string | undefined> = {};
let scratchDir: string;

describe('ConfigParser environment mode', () => {
  let parser: ConfigParser;
  let originalFindConfigFile: any;

  beforeEach(() => {
    savedEnv = {};
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    scratchDir = mkdtempSync(join(tmpdir(), 'env-config-test-'));
    ConfigParser.resetForTesting();

    parser = ConfigParser.getInstance();
    originalFindConfigFile = (parser as any).findConfigFile;
    (parser as any).findConfigFile = () => null;
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    (parser as any).findConfigFile = originalFindConfigFile;
    rmSync(scratchDir, { recursive: true, force: true });
    ConfigParser.resetForTesting();
  });

  it('reports both options when no provider or model is set', async () => {
    process.env.EXPLORBOT_URL = 'https://example.com';
    await expect(parser.loadConfig()).rejects.toThrow(/EXPLORBOT_AI_PROVIDER/);
  });

  it('prefers a config file over env vars', async () => {
    process.env.EXPLORBOT_AI_PROVIDER = 'openrouter';
    process.env.EXPLORBOT_URL = 'https://env.example.com';

    const originalLoadConfigModule = (parser as any).loadConfigModule;
    (parser as any).findConfigFile = () => '/virtual/explorbot.config.ts';
    (parser as any).loadConfigModule = async () => ({
      default: {
        playwright: { url: 'https://file.example.com', browser: 'chromium' },
        ai: { model: { modelId: 'test-model', provider: 'test' } },
      },
    });

    try {
      const config = await parser.loadConfig();
      expect(config.playwright.url).toBe('https://file.example.com');
    } finally {
      (parser as any).loadConfigModule = originalLoadConfigModule;
    }
  });

  it('throws when no URL comes from env or argument', async () => {
    process.env.EXPLORBOT_AI_MODEL = 'openrouter/openai/gpt-oss-120b';
    await expect(parser.loadConfig()).rejects.toThrow(/EXPLORBOT_URL/);
  });

  it('uses the baseUrl argument when EXPLORBOT_URL is unset', async () => {
    process.env.EXPLORBOT_AI_MODEL = 'openrouter/openai/gpt-oss-120b';
    process.env.EXPLORBOT_OUTPUT = scratchDir;

    const config = await parser.loadConfig({ baseUrl: 'https://from-argument.example.com' });

    expect(config.playwright.url).toBe('https://from-argument.example.com');
  });

  it('splits the model spec on the first slash only', async () => {
    const model = await resolveModel('openrouter/openai/gpt-oss-120b:nitro');
    expect(model.modelId).toBe('openai/gpt-oss-120b:nitro');
  });

  it('rejects an unknown provider and lists supported ones', async () => {
    await expect(resolveModel('nosuchprovider/some-model')).rejects.toThrow(/openrouter/);
  });

  it('resolves a bare provider name to its recommended model', async () => {
    const recommended = ConfigParser.recommendedModels().openrouter;
    expect((await resolveModel('openrouter')).modelId).toBe(recommended.model);
    expect((await resolveModel('openrouter', 'visionModel')).modelId).toBe(recommended.visionModel);
    expect((await resolveModel('openrouter', 'agenticModel')).modelId).toBe(recommended.agenticModel);
  });

  it('rejects a bare name with no recommendations and lists the providers that have them', async () => {
    await expect(resolveModel('gpt-oss-120b')).rejects.toThrow(/openrouter/);
  });

  it('rejects a role the provider has no recommendation for', async () => {
    await expect(resolveModel('anthropic', 'model')).rejects.toThrow(/no recommended model/);
  });

  it('fills every role from one provider name', async () => {
    process.env.EXPLORBOT_AI_PROVIDER = 'openrouter';
    process.env.EXPLORBOT_URL = 'https://example.com';
    process.env.EXPLORBOT_OUTPUT = scratchDir;

    const recommended = ConfigParser.recommendedModels().openrouter;
    const config = await parser.loadConfig();

    expect(config.ai.model.modelId).toBe(recommended.model);
    expect(config.ai.visionModel.modelId).toBe(recommended.visionModel);
    expect(config.ai.agenticModel.modelId).toBe(recommended.agenticModel);
  });

  it('lets an explicit role override the provider recommendation', async () => {
    process.env.EXPLORBOT_AI_PROVIDER = 'openrouter';
    process.env.EXPLORBOT_AGENTIC_MODEL = 'groq/openai/gpt-oss-120b';
    process.env.EXPLORBOT_URL = 'https://example.com';
    process.env.EXPLORBOT_OUTPUT = scratchDir;

    const config = await parser.loadConfig();

    expect(config.ai.model.modelId).toBe(ConfigParser.recommendedModels().openrouter.model);
    expect(config.ai.agenticModel.modelId).toBe('openai/gpt-oss-120b');
  });

  it('leaves other roles unset when an explicit model id is given', async () => {
    process.env.EXPLORBOT_AI_MODEL = 'openrouter/openai/gpt-oss-120b';
    process.env.EXPLORBOT_URL = 'https://example.com';
    process.env.EXPLORBOT_OUTPUT = scratchDir;

    const config = await parser.loadConfig();

    expect(config.ai.model.modelId).toBe('openai/gpt-oss-120b');
    expect(config.ai.visionModel).toBeUndefined();
    expect(config.ai.agenticModel).toBeUndefined();
  });

  it('uses EXPLORBOT_AI_MODEL as the model id under EXPLORBOT_AI_PROVIDER', async () => {
    process.env.EXPLORBOT_AI_PROVIDER = 'openrouter';
    process.env.EXPLORBOT_AI_MODEL = 'openai/gpt-oss-120b:nitro';
    process.env.EXPLORBOT_URL = 'https://example.com';
    process.env.EXPLORBOT_OUTPUT = scratchDir;

    const config = await parser.loadConfig();

    expect(config.ai.model.modelId).toBe('openai/gpt-oss-120b:nitro');
    expect(config.ai.visionModel.modelId).toBe(ConfigParser.recommendedModels().openrouter.visionModel);
    expect(config.ai.agenticModel.modelId).toBe(ConfigParser.recommendedModels().openrouter.agenticModel);
  });

  it('rejects a bare model id when no provider is set', async () => {
    process.env.EXPLORBOT_AI_MODEL = 'some-model';
    process.env.EXPLORBOT_URL = 'https://example.com';
    await expect(parser.loadConfig()).rejects.toThrow(/EXPLORBOT_AI_PROVIDER/);
  });

  it('respects EXPLORBOT_OUTPUT as the output root', () => {
    process.env.EXPLORBOT_OUTPUT = scratchDir;
    expect(resolveOutputRoot()).toBe(scratchDir);
  });

  it('creates a temp output root when EXPLORBOT_OUTPUT is unset', () => {
    const root = resolveOutputRoot();
    expect(root.startsWith(tmpdir())).toBe(true);
    expect(existsSync(root)).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it('disables experience and historian and keeps output at the config root', async () => {
    process.env.EXPLORBOT_AI_MODEL = 'openrouter/openai/gpt-oss-120b';
    process.env.EXPLORBOT_URL = 'https://example.com';
    process.env.EXPLORBOT_OUTPUT = scratchDir;

    const config = await parser.loadConfig();

    expect(config.dirs?.output).toBe('.');
    expect(config.experience?.disabled).toBe(true);
    expect(config.ai.agents?.historian?.enabled).toBe(false);
    expect(parser.getOutputDir()).toBe(scratchDir);
  });

  it('resolves optional vision and agentic models', async () => {
    process.env.EXPLORBOT_AI_MODEL = 'groq/openai/gpt-oss-20b';
    process.env.EXPLORBOT_VISION_MODEL = 'groq/meta-llama/llama-4-scout-17b-16e-instruct';
    process.env.EXPLORBOT_AGENTIC_MODEL = 'groq/openai/gpt-oss-120b';
    process.env.EXPLORBOT_URL = 'https://example.com';
    process.env.EXPLORBOT_OUTPUT = scratchDir;

    const config = await parser.loadConfig();

    expect(config.ai.visionModel.modelId).toBe('meta-llama/llama-4-scout-17b-16e-instruct');
    expect(config.ai.agenticModel.modelId).toBe('openai/gpt-oss-120b');
  });

  it('writes inline knowledge as a global file matching every url and endpoint', () => {
    process.env.EXPLORBOT_KNOWLEDGE = 'Use admin/admin123 to log in';

    materializeKnowledge(scratchDir);

    const content = readFileSync(join(scratchDir, 'knowledge', 'global.md'), 'utf8');
    expect(content).toContain("url: '*'");
    expect(content).toContain("endpoint: '*'");
    expect(content).toContain('Use admin/admin123 to log in');
  });

  it('copies EXPLORBOT_KNOWLEDGE_FILE by basename', () => {
    const source = join(scratchDir, 'login.md');
    writeFileSync(source, '---\nurl: /login\n---\n\nUse admin/admin123\n');
    process.env.EXPLORBOT_KNOWLEDGE_FILE = source;

    materializeKnowledge(scratchDir);

    expect(readFileSync(join(scratchDir, 'knowledge', 'login.md'), 'utf8')).toContain('url: /login');
  });

  it('throws when EXPLORBOT_KNOWLEDGE_FILE does not exist', () => {
    process.env.EXPLORBOT_KNOWLEDGE_FILE = join(scratchDir, 'missing.md');
    expect(() => materializeKnowledge(scratchDir)).toThrow(/not found/);
  });

  it('accepts inline knowledge and a knowledge file at once', () => {
    const source = join(scratchDir, 'checkout.md');
    writeFileSync(source, 'Checkout uses a test card\n');
    process.env.EXPLORBOT_KNOWLEDGE_FILE = source;
    process.env.EXPLORBOT_KNOWLEDGE = 'Global note';

    materializeKnowledge(scratchDir);

    expect(existsSync(join(scratchDir, 'knowledge', 'global.md'))).toBe(true);
    expect(existsSync(join(scratchDir, 'knowledge', 'checkout.md'))).toBe(true);
  });

  it('writes no knowledge dir when neither knowledge var is set', () => {
    materializeKnowledge(scratchDir);
    expect(existsSync(join(scratchDir, 'knowledge'))).toBe(false);
  });
});

describe('EXPLORBOT_ENV_VARS registry', () => {
  it('documents every EXPLORBOT_ variable the code reads', () => {
    const sources = ['src/config.ts', 'bin/explorbot-cli.ts', 'boat/api-tester/src/config.ts', 'boat/doc-collector/src/cli.ts'];
    const used = new Set<string>();

    for (const source of sources) {
      const code = readFileSync(source, 'utf8');
      for (const match of code.matchAll(/process\.env\.(EXPLORBOT_[A-Z_]+)/g)) {
        used.add(match[1]);
      }
    }

    const documented = new Set(EXPLORBOT_ENV_VARS.map((v) => v.name));
    const undocumented = [...used].filter((name) => !documented.has(name));

    expect(undocumented).toEqual([]);
  });

  it('lists no variable the code never reads', () => {
    const code = ['src/config.ts', 'bin/explorbot-cli.ts', 'boat/api-tester/src/config.ts'].map((f) => readFileSync(f, 'utf8')).join('\n');
    const unused = EXPLORBOT_ENV_VARS.filter((v) => !code.includes(`process.env.${v.name}`));

    expect(unused.map((v) => v.name)).toEqual([]);
  });
});
