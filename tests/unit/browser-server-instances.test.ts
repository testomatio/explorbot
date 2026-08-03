import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { getEndpointFilePath, listInstances } from '../../src/browser-server.ts';
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

  test('lists nothing when endpoint dir is missing', () => {
    expect(listInstances()).toEqual([]);
  });
});
