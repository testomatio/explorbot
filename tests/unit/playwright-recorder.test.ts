import { describe, expect, it } from 'bun:test';
import { PlaywrightRecorder, type TraceCall, parseTrace, renderAssertion, renderCall } from '../../src/playwright-recorder.ts';

function ndjson(...events: any[]): string {
  return events.map((e) => JSON.stringify(e)).join('\n');
}

function before(callId: string, cls: string, method: string, params: any, parentId?: string, title?: string) {
  const evt: any = { type: 'before', callId, class: cls, method, params };
  if (parentId) evt.parentId = parentId;
  if (title !== undefined) evt.title = title;
  return evt;
}

function after(callId: string, error?: any) {
  const evt: any = { type: 'after', callId };
  if (error) evt.error = error;
  return evt;
}

function group(callId: string, title: string) {
  return before(callId, 'Tracing', 'tracingGroup', {}, undefined, title);
}

describe('parseTrace', () => {
  it('buckets calls by group title', () => {
    const trace = ndjson(
      group('g1', 'explorbot#1:click save'),
      before('c1', 'Frame', 'click', { selector: 'internal:role=button[name="Save"i]' }, 'g1'),
      after('c1'),
      after('g1'),
      group('g2', 'explorbot#2:fill email'),
      before('c2', 'Frame', 'fill', { selector: 'input[name="email"]', value: 'a@b.c' }, 'g2'),
      after('c2'),
      after('g2')
    );
    const groups = parseTrace(trace);
    expect(groups.get('explorbot#1:click save')).toHaveLength(1);
    expect(groups.get('explorbot#2:fill email')).toHaveLength(1);
    expect(groups.get('explorbot#1:click save')![0].method).toBe('click');
    expect(groups.get('explorbot#2:fill email')![0].method).toBe('fill');
  });

  it('filters noise methods (queryCount, isVisible, textContent, evaluateExpression, waitForSelector)', () => {
    const trace = ndjson(
      group('g1', 'noise-test'),
      before('c1', 'Frame', 'queryCount', { selector: 'button' }, 'g1'),
      after('c1'),
      before('c2', 'Frame', 'isVisible', { selector: 'button' }, 'g1'),
      after('c2'),
      before('c3', 'Frame', 'textContent', { selector: 'h1' }, 'g1'),
      after('c3'),
      before('c4', 'Frame', 'evaluateExpression', { expression: '() => 1' }, 'g1'),
      after('c4'),
      before('c5', 'Frame', 'waitForSelector', { selector: 'button' }, 'g1'),
      after('c5'),
      after('g1')
    );
    const groups = parseTrace(trace);
    expect(groups.get('noise-test')).toEqual([]);
  });

  it('excludes failed calls', () => {
    const trace = ndjson(group('g1', 'failed-call'), before('c1', 'Frame', 'click', { selector: 'button' }, 'g1'), after('c1', { message: 'Timeout', name: 'TimeoutError' }), before('c2', 'Frame', 'click', { selector: 'a' }, 'g1'), after('c2'), after('g1'));
    const groups = parseTrace(trace);
    expect(groups.get('failed-call')).toHaveLength(1);
    expect(groups.get('failed-call')![0].params.selector).toBe('a');
  });

  it('ignores calls without a parentId (not in any group)', () => {
    const trace = ndjson(before('c0', 'Frame', 'click', { selector: 'button' }), after('c0'), group('g1', 'in-group'), before('c1', 'Frame', 'click', { selector: 'a' }, 'g1'), after('c1'), after('g1'));
    const groups = parseTrace(trace);
    expect(groups.size).toBe(1);
    expect(groups.get('in-group')).toHaveLength(1);
  });

  it('ignores malformed NDJSON lines', () => {
    const lines = [JSON.stringify(group('g1', 'malformed')), 'this is not json', '', JSON.stringify(before('c1', 'Frame', 'click', { selector: 'button' }, 'g1')), JSON.stringify(after('c1')), JSON.stringify(after('g1'))];
    const groups = parseTrace(lines.join('\n'));
    expect(groups.get('malformed')).toHaveLength(1);
  });
});

describe('renderCall', () => {
  function call(cls: string, method: string, params: any = {}): TraceCall {
    return { class: cls, method, params };
  }

  it('renders Frame.goto', () => {
    expect(renderCall(call('Frame', 'goto', { url: '/login' }))).toBe(`await page.goto("/login");`);
  });

  it('renders Frame.click with role locator idiomatically', () => {
    expect(renderCall(call('Frame', 'click', { selector: 'internal:role=button[name="Save"i]' }))).toBe(`await page.getByRole('button', { name: 'Save' }).click();`);
  });

  it('renders Frame.fill with getByLabel', () => {
    expect(renderCall(call('Frame', 'fill', { selector: 'internal:label="Email"s', value: 'a@b.c' }))).toBe(`await page.getByLabel('Email', { exact: true }).fill("a@b.c");`);
  });

  it('renders Frame.fill with raw css', () => {
    expect(renderCall(call('Frame', 'fill', { selector: 'input[name="email"]', value: 'a@b.c' }))).toBe(`await page.locator('input[name="email"]').fill("a@b.c");`);
  });

  it('renders Frame.press with key', () => {
    expect(renderCall(call('Frame', 'press', { selector: 'input', key: 'Enter' }))).toBe(`await page.locator('input').press("Enter");`);
  });

  it('renders Frame.selectOption with single valueOrLabel', () => {
    expect(renderCall(call('Frame', 'selectOption', { selector: 'select', options: [{ valueOrLabel: 'US' }] }))).toBe(`await page.locator('select').selectOption("US");`);
  });

  it('renders Frame.check / Frame.uncheck', () => {
    expect(renderCall(call('Frame', 'check', { selector: 'input' }))).toBe(`await page.locator('input').check();`);
    expect(renderCall(call('Frame', 'uncheck', { selector: 'input' }))).toBe(`await page.locator('input').uncheck();`);
  });

  it('renders Frame.hover / tap / focus / scrollIntoViewIfNeeded', () => {
    const sel = { selector: 'button' };
    expect(renderCall(call('Frame', 'hover', sel))).toBe(`await page.locator('button').hover();`);
    expect(renderCall(call('Frame', 'tap', sel))).toBe(`await page.locator('button').tap();`);
    expect(renderCall(call('Frame', 'focus', sel))).toBe(`await page.locator('button').focus();`);
    expect(renderCall(call('Frame', 'scrollIntoViewIfNeeded', sel))).toBe(`await page.locator('button').scrollIntoViewIfNeeded();`);
  });

  it('renders Page.keyboard* events', () => {
    expect(renderCall(call('Page', 'keyboardPress', { key: 'Escape' }))).toBe(`await page.keyboard.press("Escape");`);
    expect(renderCall(call('Page', 'keyboardType', { text: 'hello' }))).toBe(`await page.keyboard.type("hello");`);
  });

  it('renders Page.mouseClick with coordinates', () => {
    expect(renderCall(call('Page', 'mouseClick', { x: 100, y: 200 }))).toBe(`await page.mouse.click(100, 200);`);
  });

  it('falls back to TODO comment for unknown event', () => {
    expect(renderCall(call('Frame', 'ariaSnapshot', { selector: 'body' }))).toMatch(/^\/\/ TODO\(playwright\)/);
  });

  it('renders Frame.setInputFiles using params.localPaths (Playwright`s real param name)', () => {
    expect(renderCall(call('Frame', 'setInputFiles', { selector: 'input[type=file]', localPaths: ['/tmp/sample.png'] }))).toBe(`await page.locator('input[type=file]').setInputFiles("/tmp/sample.png");`);
  });
});

describe('renderAssertion', () => {
  function assertion(name: string, ...args: any[]) {
    return { name, args };
  }

  it('renders see → toContainText', () => {
    expect(renderAssertion(assertion('see', 'Welcome'))).toBe(`await expect(page).toContainText("Welcome");`);
  });

  it('renders dontSee → not.toContainText', () => {
    expect(renderAssertion(assertion('dontSee', 'Error'))).toBe(`await expect(page).not.toContainText("Error");`);
  });

  it('renders seeElement → toBeVisible', () => {
    expect(renderAssertion(assertion('seeElement', '.banner'))).toBe(`await expect(page.locator(".banner")).toBeVisible();`);
  });

  it('renders dontSeeElement → toBeHidden', () => {
    expect(renderAssertion(assertion('dontSeeElement', '#modal'))).toBe(`await expect(page.locator("#modal")).toBeHidden();`);
  });

  it('renders seeInField → toHaveValue', () => {
    expect(renderAssertion(assertion('seeInField', 'input[name=email]', 'a@b.c'))).toBe(`await expect(page.locator("input[name=email]")).toHaveValue("a@b.c");`);
  });

  it('renders dontSeeInField → not.toHaveValue', () => {
    expect(renderAssertion(assertion('dontSeeInField', 'input[name=email]', 'old@x.y'))).toBe(`await expect(page.locator("input[name=email]")).not.toHaveValue("old@x.y");`);
  });

  it('renders seeInCurrentUrl → toHaveURL with escaped regex', () => {
    expect(renderAssertion(assertion('seeInCurrentUrl', '/dashboard?tab=1'))).toBe(`await expect(page).toHaveURL(new RegExp("/dashboard\\\\?tab=1"));`);
  });

  it('renders dontSeeInCurrentUrl → not.toHaveURL', () => {
    expect(renderAssertion(assertion('dontSeeInCurrentUrl', '/login'))).toBe(`await expect(page).not.toHaveURL(new RegExp("/login"));`);
  });

  it('falls back to TODO comment for unknown assertion name', () => {
    expect(renderAssertion(assertion('seeHttpHeader', 'X-Api', 'v1'))).toBe(`// TODO(playwright): seeHttpHeader("X-Api", "v1")`);
  });

  it('falls back to TODO when seeElement arg is not a string', () => {
    expect(renderAssertion(assertion('seeElement', { css: '.x' }))).toMatch(/^\/\/ TODO\(playwright\)/);
  });

  it('falls back to TODO when seeInField is missing the value', () => {
    expect(renderAssertion(assertion('seeInField', 'input'))).toMatch(/^\/\/ TODO\(playwright\)/);
  });
});

describe('PlaywrightRecorder.recordVerification', () => {
  it('drops duplicate steps (same name + args) from a single call', () => {
    const rec = new PlaywrightRecorder();
    rec.recordVerification([
      { name: 'see', args: ['New Run'] },
      { name: 'see', args: ['New Run'] },
      { name: 'seeElement', args: ['.status-badge'] },
    ]);
    expect(rec.drainVerifications()).toEqual([
      { name: 'see', args: ['New Run'] },
      { name: 'seeElement', args: ['.status-badge'] },
    ]);
  });

  it('drops duplicates across multiple recordVerification calls in one drain cycle', () => {
    const rec = new PlaywrightRecorder();
    rec.recordVerification([{ name: 'see', args: ['John Doe'] }]);
    rec.recordVerification([
      { name: 'see', args: ['John Doe'] },
      { name: 'see', args: ['STAGING SERVER'] },
    ]);
    rec.recordVerification([{ name: 'see', args: ['STAGING SERVER'] }]);
    expect(rec.drainVerifications()).toEqual([
      { name: 'see', args: ['John Doe'] },
      { name: 'see', args: ['STAGING SERVER'] },
    ]);
  });

  it('keeps different arg values distinct', () => {
    const rec = new PlaywrightRecorder();
    rec.recordVerification([
      { name: 'see', args: ['A'] },
      { name: 'see', args: ['B'] },
      { name: 'seeInField', args: ['#title', 'A'] },
      { name: 'seeInField', args: ['#title', 'B'] },
    ]);
    expect(rec.drainVerifications()).toHaveLength(4);
  });
});
