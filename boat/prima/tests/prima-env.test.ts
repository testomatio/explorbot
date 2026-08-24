import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { EXPLORBOT_ENV_VARS } from '../../../src/config.ts';
import { Prima } from '../src/prima.ts';

const TOUCHED = ['EXPLORBOT_AI_PROVIDER', 'PRIMA_CLI_AI_PROVIDER', 'EXPLORBOT_URL', 'PRIMA_CLI_URL', 'EXPLORBOT_EPHEMERAL', 'PRIMA_CLI_EPHEMERAL'];

let saved: Record<string, string | undefined> = {};

describe('prima env', () => {
  beforeEach(() => {
    saved = {};
    for (const name of TOUCHED) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('mirrors a PRIMA_CLI_ variable onto the EXPLORBOT_ one it names', () => {
    process.env.PRIMA_CLI_AI_PROVIDER = 'groq';
    Prima.applyEnv();
    expect(process.env.EXPLORBOT_AI_PROVIDER).toBe('groq');
  });

  it('wins over the EXPLORBOT_ variable when both are set', () => {
    process.env.EXPLORBOT_AI_PROVIDER = 'openai';
    process.env.PRIMA_CLI_URL = 'https://prima.example';
    process.env.EXPLORBOT_URL = 'https://explorbot.example';
    process.env.PRIMA_CLI_AI_PROVIDER = 'groq';

    Prima.applyEnv();

    expect(process.env.EXPLORBOT_AI_PROVIDER).toBe('groq');
    expect(process.env.EXPLORBOT_URL).toBe('https://prima.example');
  });

  it('leaves an EXPLORBOT_ variable alone when its PRIMA_CLI_ counterpart is unset', () => {
    process.env.EXPLORBOT_URL = 'https://explorbot.example';
    Prima.applyEnv();
    expect(process.env.EXPLORBOT_URL).toBe('https://explorbot.example');
  });

  it('covers every registered variable, so a new one needs no change here', () => {
    for (const { name } of EXPLORBOT_ENV_VARS) {
      const primaName = name.replace('EXPLORBOT_', 'PRIMA_CLI_');
      const restore = process.env[name];
      process.env[primaName] = 'mirrored';

      Prima.applyEnv();
      expect(process.env[name]).toBe('mirrored');

      delete process.env[primaName];
      if (restore === undefined) delete process.env[name];
      else process.env[name] = restore;
    }
  });
});
