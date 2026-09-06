import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApibotConfigParser } from '../../boat/api-tester/src/config.ts';
import { ConfigParser } from '../../src/config.ts';

const ENV_KEYS = ['EXPLORBOT_AI_PROVIDER', 'EXPLORBOT_AI_MODEL', 'EXPLORBOT_URL', 'EXPLORBOT_OUTPUT', 'EXPLORBOT_API_SPEC', 'EXPLORBOT_API_HEADERS'];

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

  it('overrides the config file endpoint and spec with the command options', async () => {
    const configPath = join(outputRoot, 'apibot.config.js');
    writeFileSync(configPath, "export default { ai: { model: { modelId: 'test-model' } }, api: { baseEndpoint: 'https://staging.example.com/v1', spec: ['./staging.yaml'] } };\n", 'utf8');

    const config = await parser.loadConfig({ config: configPath, baseEndpoint: 'https://api.example.com/v2/', spec: './openapi.yaml' });

    expect(config.api.baseEndpoint).toBe('https://api.example.com/v2');
    expect(config.api.spec).toEqual(['./openapi.yaml']);
  });

  it('maps the --endpoint option to the base endpoint without a config file', async () => {
    process.env.EXPLORBOT_AI_MODEL = 'openrouter/openai/gpt-oss-120b';
    process.env.EXPLORBOT_OUTPUT = outputRoot;

    const config = await parser.loadConfig({ baseEndpoint: 'https://api.example.com/v1' });

    expect(config.api.baseEndpoint).toBe('https://api.example.com/v1');
    expect(process.env.EXPLORBOT_URL).toBe('https://api.example.com/v1');
  });

  it('resolves an absolute endpoint against the base endpoint path without a site', async () => {
    process.env.EXPLORBOT_AI_MODEL = 'openrouter/openai/gpt-oss-120b';
    process.env.EXPLORBOT_OUTPUT = outputRoot;

    await parser.loadConfig({ baseEndpoint: 'https://api.example.com/v1' });

    expect(parser.resolveEndpointPath('https://api.example.com/v1')).toBe('/');
    expect(parser.resolveEndpointPath('https://api.example.com/v1/users')).toBe('/users');
    expect(parser.resolveEndpointPath('/users')).toBe('/users');
  });

  it('maps repeated --header options to api.headers', async () => {
    process.env.EXPLORBOT_AI_MODEL = 'openrouter/openai/gpt-oss-120b';
    process.env.EXPLORBOT_OUTPUT = outputRoot;

    const config = await parser.loadConfig({ baseEndpoint: 'https://api.example.com', header: ['Authorization: Bearer token-123', 'X-Tenant: acme'] });

    expect(config.api.headers).toEqual({ Authorization: 'Bearer token-123', 'X-Tenant': 'acme' });
  });

  it('merges EXPLORBOT_API_HEADERS onto the config file headers', async () => {
    const configPath = join(outputRoot, 'apibot.config.js');
    writeFileSync(configPath, "export default { ai: { model: { modelId: 'test-model' } }, api: { baseEndpoint: 'https://api.example.com', headers: { 'X-Tenant': 'staging', Accept: 'application/json' } } };\n", 'utf8');
    process.env.EXPLORBOT_API_HEADERS = 'Authorization: Bearer token-123\nX-Tenant: acme';

    const config = await parser.loadConfig({ config: configPath });

    expect(config.api.headers).toEqual({ Accept: 'application/json', 'X-Tenant': 'acme', Authorization: 'Bearer token-123' });
  });

  it('throws when EXPLORBOT_URL is unset', async () => {
    process.env.EXPLORBOT_AI_MODEL = 'openrouter/openai/gpt-oss-120b';
    await expect(parser.loadConfig()).rejects.toThrow(/EXPLORBOT_URL/);
  });

  it('throws the config-file error when no env vars are set', async () => {
    await expect(parser.loadConfig()).rejects.toThrow(/apibot.config.js/);
  });
});
