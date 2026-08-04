import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { type EnvelopeData, renderEnvelope, writeArtifacts } from '../src/envelope.ts';

const base: EnvelopeData = {
  ok: true,
  command: "pw ({ page }) => page.click('text=Login')",
  used: ["I.click('Login')"],
  page: { url: 'https://app.example.com/dashboard', previousUrl: 'https://app.example.com/login', title: 'Dashboard', state: 'dashboard_h1_dashboard', visits: 1 },
  changes: 'ariaDiff:\n  added:\n    - heading "Dashboard"',
  instance: { name: 'default', tabs: 3, startedAgo: '12m', others: [{ name: 'auth-test', tabs: 1 }] },
  artifacts: { aria: '/tmp/x/aria.yml', html: '/tmp/x/page.html', network: '/tmp/x/network.jsonl' },
};

describe('renderEnvelope', () => {
  test('success envelope contains all sections in order', () => {
    const out = renderEnvelope(base);
    const sections = ['### Result', '### Page', '### Changes', '### Instance', '### Artifacts'];
    const positions = sections.map((s) => out.indexOf(s));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(out).toContain('ok: true');
    expect(out).toContain("used: I.click('Login')");
    expect(out).toContain('(changed: https://app.example.com/login → https://app.example.com/dashboard)');
    expect(out).toContain('instance: default (3 tabs) | other instances: auth-test (1 tab)');
  });

  test('unchanged url renders without changed marker', () => {
    const out = renderEnvelope({ ...base, page: { ...base.page, previousUrl: base.page.url } });
    expect(out).not.toContain('(changed:');
  });

  test('failure envelope renders attempts, reasoning and compact aria', () => {
    const out = renderEnvelope({
      ...base,
      ok: false,
      failure: {
        error: "locator 'text=Login' not found",
        attempts: [
          { code: "I.click('Login')", outcome: 'not visible' },
          { code: 'scroll + retry', outcome: 'covered by cookie banner' },
        ],
        reasoning: 'element hidden behind consent overlay',
        compactAria: '- button "Accept all"',
      },
    });
    expect(out).toContain('### Failure');
    expect(out).toContain('### Healing attempts (2)');
    expect(out).toContain("1. I.click('Login')");
    expect(out).toContain('→ not visible');
    expect(out).toContain('### Current page (compact ARIA)');
    expect(out).toContain('- button "Accept all"');
  });

  test('answer replaces changes for ask', () => {
    const out = renderEnvelope({ ...base, changes: undefined, answer: 'A login form with email and password fields' });
    expect(out).toContain('### Answer');
    expect(out).not.toContain('### Changes');
  });

  test('research replaces changes for research', () => {
    const out = renderEnvelope({ ...base, changes: undefined, research: '## Login form\n- email field\n- password field' });
    expect(out).toContain('### Research');
    expect(out).toContain('- password field');
    expect(out).not.toContain('### Changes');
    expect(out).not.toContain('### Answer');
  });

  test('verdict replaces changes for verify', () => {
    const out = renderEnvelope({ ...base, changes: undefined, verdict: { passed: true, evidence: 'heading "Dashboard" present', code: "I.see('Dashboard')" } });
    expect(out).toContain('### Verdict');
    expect(out).toContain('passed: true');
    expect(out).toContain("I.see('Dashboard')");
  });

  test('healed success carries note', () => {
    const out = renderEnvelope({ ...base, healed: true, healNote: 'dismissed overlay first' });
    expect(out).toContain('healed: true (dismissed overlay first)');
  });

  test('attached instance renders attached browser line', () => {
    const out = renderEnvelope({ ...base, instance: { ...base.instance, attached: 'playwright-cli session "default", workspace /w' } });
    expect(out).toContain('browser: attached (playwright-cli session "default"');
    expect(out).not.toContain('started 12m ago');
  });

  test('instance without evidence of a live browser reports it as not running', () => {
    const out = renderEnvelope({ ...base, instance: { name: 'default', tabs: 0, others: [] } });
    expect(out).toContain('browser: not running');
  });

  test('open tabs alone are evidence enough for a running browser', () => {
    const out = renderEnvelope({ ...base, instance: { name: 'default', tabs: 2, others: [] } });
    expect(out).toContain('browser: running');
    expect(out).not.toContain('browser: not running');
  });
});

describe('writeArtifacts', () => {
  test('writes aria, html and network files and returns absolute paths', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'prima-'));
    const result = writeArtifacts(dir, { aria: '- button "Login"', html: '<html></html>', requests: [{ url: '/api/user', status: 200 }] });
    expect(readFileSync(result.aria, 'utf-8')).toContain('button "Login"');
    expect(readFileSync(result.html, 'utf-8')).toContain('<html>');
    expect(readFileSync(result.network, 'utf-8')).toContain('/api/user');
    expect(path.isAbsolute(result.aria)).toBe(true);
  });
});
