import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { ConfigCommand } from '../../src/commands/config-command.js';

let tmpPath = '';
let configPath = '';

const config = {
  playwright: { browser: 'firefox', url: 'http://localhost:3000', show: true },
  ai: {
    model: { modelId: 'openai/gpt-oss-20b' },
    visionModel: { modelId: 'google/gemma-4-31b-it' },
    agents: { tester: { model: { modelId: 'anthropic/claude-sonnet-4.5' } } },
    langfuse: { enabled: true },
  },
  dirs: { output: 'out', knowledge: 'kb', experience: 'exp' },
} as any;

beforeEach(() => {
  tmpPath = mkdtempSync(path.join(tmpdir(), 'explorbot-config-command-'));
  configPath = path.join(tmpPath, 'explorbot.config.js');
  writeFileSync(configPath, 'export default {};');
  Reflect.deleteProperty(process.env, 'EXPLORBOT_AI_PROVIDER');
});

afterEach(() => {
  rmSync(tmpPath, { recursive: true, force: true });
  Reflect.deleteProperty(process.env, 'EXPLORBOT_AI_PROVIDER');
});

describe('ConfigCommand.data', () => {
  it('reports models per role including agent overrides', () => {
    const data = ConfigCommand.data(config, { configPath, root: tmpPath });

    expect(data.models).toEqual({
      model: 'openai/gpt-oss-20b',
      visionModel: 'google/gemma-4-31b-it',
      tester: 'anthropic/claude-sonnet-4.5',
    });
  });

  it('resolves configured directories against the project root', () => {
    const data = ConfigCommand.data(config, { configPath, root: tmpPath });

    expect(data.dirs).toEqual({
      output: path.join(tmpPath, 'out'),
      knowledge: path.join(tmpPath, 'kb'),
      experience: path.join(tmpPath, 'exp'),
    });
  });

  it('leaves the config file empty when it was built from the environment', () => {
    const data = ConfigCommand.data(config, { configPath: path.join(tmpPath, 'never-written.js'), root: tmpPath });

    expect(data.config).toBe('');
    expect(data.url).toBe('http://localhost:3000');
    expect(data.headless).toBe(false);
  });

  it('lists only the EXPLORBOT_ variables that are set', () => {
    process.env.EXPLORBOT_AI_PROVIDER = 'openrouter';
    const data = ConfigCommand.data(config, { configPath, root: tmpPath });

    expect(data.env.EXPLORBOT_AI_PROVIDER).toBe('openrouter');
    expect(data.env.EXPLORBOT_KNOWLEDGE).toBeUndefined();
  });

  it('falls back to the API base endpoint when there is no page url', () => {
    const data = ConfigCommand.data({ ai: config.ai, api: { baseEndpoint: 'https://api.example.com' } }, { root: tmpPath });

    expect(data.url).toBe('https://api.example.com');
    expect(data.browser).toBe('');
  });
});

describe('ConfigCommand.render', () => {
  it('prints the same values it reports as data', () => {
    const rendered = ConfigCommand.render(config, { configPath, root: tmpPath });

    expect(rendered).toContain(configPath);
    expect(rendered).toContain('firefox, visible');
    expect(rendered).toContain('anthropic/claude-sonnet-4.5');
    expect(rendered).toContain('langfuse');
  });

  it('returns json when asked for it', () => {
    const rendered = ConfigCommand.render(config, { configPath, root: tmpPath, json: true });

    expect(JSON.parse(rendered)).toEqual(ConfigCommand.data(config, { configPath, root: tmpPath }));
  });
});
