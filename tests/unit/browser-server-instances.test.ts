import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getEndpointFilePath, listInstances, stopServer } from '../../src/browser-server.ts';
import { ConfigParser } from '../../src/config.ts';

describe('named instances', () => {
  beforeEach(() => {
    ConfigParser.resetForTesting();
    ConfigParser.setupTestConfig();
  });

  afterEach(() => {
    const dir = path.dirname(getEndpointFilePath());
    rmSync(dir, { recursive: true, force: true });
    ConfigParser.resetForTesting();
  });

  test('default instance keeps legacy filename', () => {
    expect(path.basename(getEndpointFilePath())).toBe('.browser-endpoint');
    expect(path.basename(getEndpointFilePath('default'))).toBe('.browser-endpoint');
  });

  test('named instance gets suffixed filename', () => {
    expect(path.basename(getEndpointFilePath('staging'))).toBe('.browser-endpoint-staging');
  });

  test('instance name with unsupported characters is rejected', () => {
    expect(() => getEndpointFilePath('Staging')).toThrow();
    expect(() => getEndpointFilePath('../escape')).toThrow();
    expect(() => getEndpointFilePath('')).toThrow();
  });

  test('lists instances from endpoint files', () => {
    const dir = path.dirname(getEndpointFilePath());
    mkdirSync(dir, { recursive: true });
    writeFileSync(getEndpointFilePath(), 'ws://localhost:1111/default\n', 'utf8');
    writeFileSync(getEndpointFilePath('staging'), 'ws://localhost:2222/staging\n', 'utf8');
    writeFileSync(path.join(dir, 'other-file.txt'), 'ignored', 'utf8');

    const instances = listInstances().sort((a, b) => a.name.localeCompare(b.name));

    expect(instances).toEqual([
      { name: 'default', endpoint: 'ws://localhost:1111/default' },
      { name: 'staging', endpoint: 'ws://localhost:2222/staging' },
    ]);
  });

  test('skips malformed endpoint filenames instead of naming them default', () => {
    const dir = path.dirname(getEndpointFilePath());
    mkdirSync(dir, { recursive: true });
    writeFileSync(getEndpointFilePath(), 'ws://localhost:1111/default\n', 'utf8');
    writeFileSync(path.join(dir, '.browser-endpoint-'), 'ws://localhost:3333/malformed\n', 'utf8');
    writeFileSync(path.join(dir, '.browser-endpointX'), 'ws://localhost:4444/malformed\n', 'utf8');
    writeFileSync(path.join(dir, '.browser-endpoint-Staging'), 'ws://localhost:5555/malformed\n', 'utf8');

    expect(listInstances()).toEqual([{ name: 'default', endpoint: 'ws://localhost:1111/default' }]);
  });

  test('lists nothing when endpoint dir is missing', () => {
    expect(listInstances()).toEqual([]);
  });

  test('stopping an instance with a dead endpoint reports nothing was running and clears it', async () => {
    const dir = path.dirname(getEndpointFilePath());
    mkdirSync(dir, { recursive: true });
    writeFileSync(getEndpointFilePath('staging'), 'ws://127.0.0.1:1/staging', 'utf8');

    expect(await stopServer('staging')).toBe(false);
    expect(listInstances()).toEqual([]);
  });
});
