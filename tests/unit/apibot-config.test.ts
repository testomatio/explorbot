import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApibotConfigParser } from '../../boat/api-tester/src/config.ts';
import { ConfigParser } from '../../src/config.ts';

const ENV_KEYS = ['EXPLORBOT_AI_PROVIDER', 'EXPLORBOT_AI_MODEL', 'EXPLORBOT_URL', 'EXPLORBOT_OUTPUT', 'EXPLORBOT_API_SPEC'];

describe('ApibotConfigParser environment fallback', () => {
  let savedEnv: Record<string, string | undefined> = {};
  let outputRoot: string;
  let parser: ApibotConfigParser;
  let originalFindConfigFile: any;

  beforeEach(() => {
    savedEnv = {};
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    outputRoot = mkdtempSync(join(tmpdir(), 'apibot-env-test-'));
    ConfigParser.resetForTesting();

    parser = ApibotConfigParser.getInstance();
    (parser as any).config = null;
    (parser as any).configPath = null;
    originalFindConfigFile = (parser as any).findConfigFile;
    (parser as any).findConfigFile = () => null;
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    (parser as any).findConfigFile = originalFindConfigFile;
    (parser as any).config = null;
    (parser as any).configPath = null;
    rmSync(outputRoot, { recursive: true, force: true });
    ConfigParser.resetForTesting();
  });

  it('maps EXPLORBOT_URL to the API base endpoint', async () => {
    process.env.EXPLORBOT_AI_MODEL = 'openrouter/openai/gpt-oss-120b';
    process.env.EXPLORBOT_URL = 'https://api.example.com';
    process.env.EXPLORBOT_OUTPUT = outputRoot;

    const config = await parser.loadConfig();

    expect(config.api.baseEndpoint).toBe('https://api.example.com');
    expect(parser.getConfigPath()).toBe(join(outputRoot, 'apibot.config.js'));
    expect(parser.getOutputDir()).toBe(outputRoot);
    expect(parser.getKnowledgeDir()).toBe(join(outputRoot, 'knowledge'));
  });

  it('maps EXPLORBOT_API_SPEC to api.spec', async () => {
    process.env.EXPLORBOT_AI_MODEL = 'openrouter/openai/gpt-oss-120b';
    process.env.EXPLORBOT_URL = 'https://api.example.com';
    process.env.EXPLORBOT_OUTPUT = outputRoot;
    process.env.EXPLORBOT_API_SPEC = './openapi.yaml';

    const config = await parser.loadConfig();

    expect(config.api.spec).toEqual(['./openapi.yaml']);
  });

  it('throws when EXPLORBOT_URL is unset', async () => {
    process.env.EXPLORBOT_AI_MODEL = 'openrouter/openai/gpt-oss-120b';
    await expect(parser.loadConfig()).rejects.toThrow(/EXPLORBOT_URL/);
  });

  it('throws the config-file error when no env vars are set', async () => {
    await expect(parser.loadConfig()).rejects.toThrow(/apibot.config.js/);
  });
});
