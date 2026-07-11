import { beforeEach, describe, expect, it } from 'bun:test';
import { clearRegisteredSecrets, isSecretName, redactSecrets, registerSecret } from '../../src/utils/secrets';

describe('secrets', () => {
  beforeEach(() => {
    clearRegisteredSecrets();
  });

  it('redacts a registered value', () => {
    registerSecret('hunter2secret');
    expect(redactSecrets('login with hunter2secret now')).toBe('login with ***REDACTED*** now');
  });

  it('passes unregistered values through unchanged', () => {
    registerSecret('hunter2secret');
    expect(redactSecrets('nothing to hide here')).toBe('nothing to hide here');
  });

  it('does not redact short values', () => {
    registerSecret('12');
    expect(redactSecrets('code 12 is fine')).toBe('code 12 is fine');
  });

  it('replaces every occurrence', () => {
    registerSecret('topsecret');
    expect(redactSecrets('topsecret and topsecret again')).toBe('***REDACTED*** and ***REDACTED*** again');
  });

  it('detects credential-named keys', () => {
    expect(isSecretName('APP_PASSWORD')).toBe(true);
    expect(isSecretName('ai.apiKey')).toBe(true);
    expect(isSecretName('SESSION_TOKEN')).toBe(true);
    expect(isSecretName('BASE_URL')).toBe(false);
    expect(isSecretName('playwright.browser')).toBe(false);
  });
});
