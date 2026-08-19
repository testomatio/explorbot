import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
    const sections = ['### Result', '### Page', '### Changes', '### Instance'];
    const positions = sections.map((s) => out.indexOf(s));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(out).toContain('ok: true');
    expect(out).toContain("used: I.click('Login')");
    expect(out).toContain('(changed: https://app.example.com/login → https://app.example.com/dashboard)');
    expect(out).toContain('default (3 tabs)');
    expect(out).toContain('other instances: auth-test (1 tab)');
  });

  test('unchanged url renders without changed marker', () => {
    const out = renderEnvelope({ ...base, page: { ...base.page, previousUrl: base.page.url } });
    expect(out).not.toContain('(changed:');
  });

  test('failure envelope renders the error and compact aria, and nothing about retries', () => {
    const out = renderEnvelope({
      ...base,
      ok: false,
      failure: {
        error: "locator 'text=Login' not found",
        compactAria: '- button "Accept all"',
      },
    });
    expect(out).toContain('### Failure');
    expect(out).toContain("locator 'text=Login' not found");
    expect(out).toContain('### Current page (compact ARIA)');
    expect(out).toContain('- button "Accept all"');
    expect(out).not.toContain('Healing');
    expect(out).not.toContain('healed');
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

  test('assertions render one line per check with its own result, and no overall verdict', () => {
    const out = renderEnvelope({
      ...base,
      changes: undefined,
      assertions: [
        { code: "I.see('Dashboard')", passed: true, proof: ['await expect(page).toContainText("Dashboard");'] },
        { code: "I.seeElement('.chart')", passed: false, proof: [] },
      ],
    });

    expect(out).toContain('### Assertions');
    expect(out).toContain("I.see('Dashboard')  => PASSED");
    expect(out).toContain("I.seeElement('.chart')  => FAILED");
    expect(out).toContain('playwright:');
    expect(out).toContain('await expect(page).toContainText("Dashboard");');
    expect(out).not.toContain('passed: ');
  });

  test('a multi-line assertion gets one result, not one per line', () => {
    const out = renderEnvelope({
      ...base,
      changes: undefined,
      assertions: [{ code: '// check the box\nI.seeElement({\n  role: "button",\n  text: "Submit"\n});', passed: false, proof: [] }],
    });

    expect(out).toContain('I.seeElement({ role: "button", text: "Submit" });  => FAILED');
    expect(out.match(/=> FAILED/g)).toHaveLength(1);
    expect(out).not.toContain('// check the box');
  });

  test('no expressible assertion is stated as such, not as a failure', () => {
    const out = renderEnvelope({ ...base, changes: undefined, assertions: [] });
    expect(out).toContain('none ran');
    expect(out).not.toContain('FAILED');
  });

  test('changes render on every action envelope, including when nothing moved', () => {
    expect(renderEnvelope({ ...base, changes: 'no change' })).toContain('### Changes\nno change');
  });

  test('changes render alongside assertions rather than replacing them', () => {
    const out = renderEnvelope({ ...base, changes: 'no change', assertions: [{ code: 'I.seeElement()', passed: true, proof: [] }] });
    expect(out).toContain('### Changes');
    expect(out).toContain('### Assertions');
  });

  test('steps report every action and check in order, with its proof', () => {
    const out = renderEnvelope({
      ...base,
      steps: [
        { label: "I.click('Add workflow')", ok: true, proof: 'ariaDiff:\n  added:\n    - textbox "Title"' },
        { label: 'I.seeAttributesOnElements({"role":"button"}, { disabled: true })', ok: true, proof: 'await expect(page.getByRole("button")).toBeDisabled();' },
        { label: "I.fillField('Title', 'x')", ok: false, proof: 'element not found' },
      ],
    });

    expect(out).toContain("1. ok   I.click('Add workflow')");
    expect(out).toContain('2. ok   I.seeAttributesOnElements');
    expect(out).toContain("3. FAIL I.fillField('Title', 'x')");
    expect(out).toContain('      element not found');
    expect(out).toContain('      await expect(page.getByRole("button")).toBeDisabled();');
  });

  test('every expected outcome is echoed with its own result, including the ones nothing checked', () => {
    const out = renderEnvelope({
      ...base,
      changes: undefined,
      expectations: [
        { text: 'the editor opens', status: 'passed' },
        { text: 'the draft is saved', status: 'failed' },
        { text: 'the list refreshes', status: 'unverified' },
      ],
    });

    expect(out).toContain('### Expected outcomes');
    expect(out).toContain('1. PASSED        the editor opens');
    expect(out).toContain('2. FAILED        the draft is saved');
    expect(out).toContain('3. not verified  the list refreshes');
  });

  test('attached instance renders attached browser line', () => {
    const out = renderEnvelope({ ...base, instance: { ...base.instance, attached: 'playwright-cli session "default", workspace /w' } });
    expect(out).toContain('attached to playwright-cli session "default"');
    expect(out).not.toContain('started 12m ago');
  });

  test('instance without evidence of a live browser reports it as not running', () => {
    const out = renderEnvelope({ ...base, instance: { name: 'default', tabs: 0, others: [] } });
    expect(out).toContain('not running');
  });

  test('the status hash is offered as the way to reach details', () => {
    const out = renderEnvelope({ ...base, status: 'abc123def456789', artifacts: undefined });
    expect(out).toContain('details: prima status abc123def456789');
    expect(out).not.toContain('### Artifacts');
  });

  test('open tabs alone are evidence enough for a running browser', () => {
    const out = renderEnvelope({ ...base, instance: { name: 'default', tabs: 2, others: [] } });
    expect(out).toContain('| running');
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
    rmSync(dir, { recursive: true, force: true });
  });
});
