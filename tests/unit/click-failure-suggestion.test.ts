import { describe, expect, it } from 'bun:test';
import { clickFailureSuggestion } from '../../src/ai/tools.ts';

const DISABLED = [
  'TimeoutError: locator.click: Timeout 3000ms exceeded.',
  'Call log:',
  '  - waiting for locator("#modal-overlays").first().getByRole("button", { name: "Select" }).first()',
  '    - locator resolved to <button disabled type="button">…</button>',
  '  - attempting click action',
  '    2 × waiting for element to be visible, enabled and stable',
  '      - element is not enabled',
].join('\n');

const COVERED = ['TimeoutError: locator.click: Timeout 3000ms exceeded.', 'Call log:', '  - attempting click action', '    <div class="overlay"></div> intercepts pointer events'].join('\n');

const NOT_VISIBLE = ['TimeoutError: locator.click: Timeout 3000ms exceeded.', 'Call log:', '  - waiting for element to be visible', '    - element is not visible'].join('\n');

const MALFORMED = 'SyntaxError: missing ) after argument list';
const CONTAINER_MISS = 'Error: Clickable element "New test" was not found inside element .dropdown-content';
const LOCATOR_MISS = 'Error: Clickable element "Close panel" was not found by text|CSS|XPath';

describe('clickFailureSuggestion', () => {
  it('tells the model a disabled element needs a precondition, not another locator', () => {
    const suggestion = clickFailureSuggestion([{ error: DISABLED }]);

    expect(suggestion).toContain('DISABLED');
    expect(suggestion).toContain('precondition');
    expect(suggestion).not.toContain('covered');
  });

  it('reports a wrong container instead of claiming the element is absent', () => {
    const suggestion = clickFailureSuggestion([{ error: CONTAINER_MISS }]);

    expect(suggestion).toContain('container');
    expect(suggestion).toContain('WITHOUT a container');
    expect(suggestion).not.toContain('not found in the DOM');
  });

  it('reports a genuine absence when a containerless attempt also missed', () => {
    const suggestion = clickFailureSuggestion([{ error: CONTAINER_MISS }, { error: LOCATOR_MISS }]);

    expect(suggestion).toContain('not found in the DOM');
  });

  it('distinguishes a covered element from a disabled one', () => {
    expect(clickFailureSuggestion([{ error: COVERED }])).toContain('covers it');
    expect(clickFailureSuggestion([{ error: NOT_VISIBLE }])).toContain('not visible');
  });

  it('prefers existence evidence anywhere in the ladder over a later not-found', () => {
    const suggestion = clickFailureSuggestion([{ error: DISABLED }, { error: LOCATOR_MISS }]);

    expect(suggestion).toContain('DISABLED');
  });

  it('reports an unparsable command instead of sending the model hunting for an element', () => {
    const suggestion = clickFailureSuggestion([{ error: MALFORMED }]);

    expect(suggestion).toContain('never parsed');
    expect(suggestion).not.toContain('xpathCheck');
    expect(suggestion).not.toContain('visualClick');
  });

  it('falls back to a generic hint when no attempt carried an error', () => {
    expect(clickFailureSuggestion([{}])).toContain('xpathCheck()');
  });
});
