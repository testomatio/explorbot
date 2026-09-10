import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInit } from '../../boat/api-tester/src/commands/init-command.ts';

describe('apibot init', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'apibot-init-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const init = async (extra: Record<string, unknown> = {}) => {
    await runInit({ path: dir, baseEndpoint: 'https://api.example.com/v1', spec: 'openapi.yaml', prefix: 'apibot', ...extra });
    return readFileSync(join(dir, 'apibot.config.js'), 'utf8');
  };

  it('writes a config the loader looks for', async () => {
    const config = await init();

    expect(config).toContain("baseEndpoint: 'https://api.example.com/v1'");
  });

  it('takes models from the provider recommendations', async () => {
    const config = await init();

    expect(config).toContain("model: 'openrouter/");
    expect(config).toContain("agenticModel: 'openrouter/");
    expect(config).not.toContain('gpt-4o');
    expect(config).not.toContain('@ai-sdk');
  });

  it('leaves out defaults and commented-out blocks', async () => {
    const config = await init();

    expect(config).not.toContain('dirs');
    expect(config).not.toContain('bootstrap');
    expect(config).not.toContain('teardown');
    expect(config).not.toContain('headers');
  });

  it('writes the spec the run cannot start without', async () => {
    const config = await init();

    expect(config).toContain("spec: ['openapi.yaml']");
  });

  it('writes an env file with the provider keys', async () => {
    await init();

    expect(readFileSync(join(dir, '.env'), 'utf8')).toContain('OPENROUTER_API_KEY=');
  });
});
