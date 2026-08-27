import { describe, expect, it } from 'bun:test';
import { compactAriaSnapshot, diffAriaSnapshots, parseAriaLocator } from '../../src/utils/aria.ts';

describe('aria', () => {
  it('returns null diff for identical snapshots', () => {
    const snapshot = `- button "Save"\n- listbox:\n  - option "One"`;

    const diff = diffAriaSnapshots(snapshot, snapshot);

    expect(diff.text).toBeNull();
    expect(diff.count).toBe(0);
  });

  it('produces YAML diff with counts', () => {
    const before = `- listbox:\n  - option "One"\n  - option "Two"\n  - option "Two"`;
    const after = `- listbox:\n  - option "Two"\n  - option "Three"\n  - option "Three"`;

    const diff = diffAriaSnapshots(before, after);

    expect(diff.text).toBe(['ariaDiff:', '  added:', '    - option "Three" (x2)', '  removed:', '    - option "One"', '    - option "Two"'].join('\n'));
  });

  it('marks modified nodes as added', () => {
    const before = `- form:\n  - button "Submit"`;
    const after = `- form:\n  - button "Submit" [disabled]`;

    const diff = diffAriaSnapshots(before, after);

    expect(diff.text).toBe(['ariaDiff:', '  added:', '    - button "Submit" [disabled]', '  removed:', '    - button "Submit"'].join('\n'));
  });

  it('reports a checked checkbox as a toggle, not as added/removed', () => {
    const diff = diffAriaSnapshots('- checkbox "Accept"', '- checkbox "Accept" [checked]');

    expect(diff.text).toBe(['ariaDiff:', '  toggled:', '    - checkbox "Accept": unchecked -> checked', '  added: []', '  removed: []'].join('\n'));
  });

  it('reports an unchecked checkbox as a toggle in the reverse direction', () => {
    const diff = diffAriaSnapshots('- checkbox "Accept" [checked]', '- checkbox "Accept"');

    expect(diff.text).toBe(['ariaDiff:', '  toggled:', '    - checkbox "Accept": checked -> unchecked', '  added: []', '  removed: []'].join('\n'));
  });

  it('keeps the toggle line even when other changes overflow the top-10 cap', () => {
    const before = [...Array.from({ length: 12 }, (_, i) => `- button "Old${i}"`), '- checkbox "Toggle Me"'].join('\n');
    const after = [...Array.from({ length: 12 }, (_, i) => `- button "New${i}"`), '- checkbox "Toggle Me" [checked]'].join('\n');

    const diff = diffAriaSnapshots(before, after);

    expect(diff.text).toContain('  toggled:');
    expect(diff.text).toContain('    - checkbox "Toggle Me": unchecked -> checked');
    expect(diff.text).toContain('+ 2 more interactive elements');
  });

  it('only flags the toggled control, leaving an identical untouched sibling alone', () => {
    const before = '- checkbox "Item"\n- checkbox "Item"';
    const after = '- checkbox "Item" [checked]\n- checkbox "Item"';

    const diff = diffAriaSnapshots(before, after);

    expect(diff.text).toBe(['ariaDiff:', '  toggled:', '    - checkbox "Item": unchecked -> checked', '  added: []', '  removed: []'].join('\n'));
  });

  it('renders expanded, pressed, and selected transitions', () => {
    expect(diffAriaSnapshots('- button "Menu"', '- button "Menu" [expanded]').text).toContain('    - button "Menu": collapsed -> expanded');
    expect(diffAriaSnapshots('- button "Bold"', '- button "Bold" [pressed]').text).toContain('    - button "Bold": unpressed -> pressed');
    expect(diffAriaSnapshots('- option "One"', '- option "One" [selected]').text).toContain('    - option "One": unselected -> selected');
  });

  it('truncates added/removed sections to top 10 but counts every change past the cap', () => {
    const before = Array.from({ length: 12 }, (_, i) => `- button "Old${i}"`).join('\n');
    const after = Array.from({ length: 12 }, (_, i) => `- button "New${i}"`).join('\n');

    const diff = diffAriaSnapshots(before, after);

    expect(diff.text).not.toBeNull();
    const dashLines = (diff.text!.match(/^ {4}- /gm) || []).length;
    expect(dashLines).toBe(20);
    const overflowLines = diff.text!.match(/^ {4}\+ 2 more interactive elements$/gm) || [];
    expect(overflowLines.length).toBe(2);
    expect(diff.text).toContain('  added:');
    expect(diff.text).toContain('  removed:');
    expect(diff.count).toBe(24);
  });

  it('ignores purely reordered nodes', () => {
    const before = `- button "First"\n- button "Second"`;
    const after = `- button "Second"\n- button "First"`;

    const diff = diffAriaSnapshots(before, after);

    expect(diff.text).toBeNull();
    expect(diff.count).toBe(0);
  });

  it('compactAriaSnapshot interactive-only mode removes headings and text', () => {
    const snapshot = `- heading "Page Title" [level=1]\n- text: Welcome\n- form:\n  - textbox "Name"\n  - button "Submit"`;
    const result = compactAriaSnapshot(snapshot, false);
    expect(result).toBe('- form:\n  - textbox "Name"\n  - button "Submit"');
  });

  it('compactAriaSnapshot compact mode keeps named non-interactive nodes', () => {
    const snapshot = `- heading "Page Title" [level=1]\n- text: Welcome\n- paragraph\n- form:\n  - textbox "Name"\n  - button "Submit"`;
    const result = compactAriaSnapshot(snapshot, true);
    expect(result).toBe('- heading "Page Title" [level=1]\n- text: Welcome\n- form:\n  - textbox "Name"\n  - button "Submit"');
  });

  it('compactAriaSnapshot fixes unnamed buttons with child content', () => {
    const snapshot = `- button:\n  - img "web_traffic"\n- button "Save"`;
    const result = compactAriaSnapshot(snapshot, false);
    expect(result).toBe('- button "{img "web_traffic"}"\n- button "Save"');
  });

  it('compactAriaSnapshot returns empty string for null', () => {
    expect(compactAriaSnapshot(null)).toBe('');
  });

  it('compactAriaSnapshot preserves tree indentation', () => {
    const snapshot = `- list:\n  - listitem:\n    - button "Edit"\n    - button "Delete"`;
    const result = compactAriaSnapshot(snapshot, false);
    expect(result).toContain('  - listitem:');
    expect(result).toContain('    - button "Edit"');
    expect(result).toContain('    - button "Delete"');
  });

  it('collapses long runs of same-role sibling nodes', () => {
    const items = Array.from({ length: 120 }, (_, i) => `  - listitem:\n    - link "Item ${i}"`).join('\n');
    const snapshot = `- list:\n${items}`;

    const result = compactAriaSnapshot(snapshot, false);

    expect(result).toContain('link "Item 0"');
    expect(result).toContain('link "Item 4"');
    expect(result).toContain('link "Item 115"');
    expect(result).toContain('link "Item 119"');
    expect(result).not.toContain('link "Item 60"');
    expect(result).toContain('- ...110 similar "listitem" items omitted...');
  });

  it('keeps sibling runs below threshold intact', () => {
    const items = Array.from({ length: 10 }, (_, i) => `  - listitem:\n    - link "Keep ${i}"`).join('\n');
    const snapshot = `- list:\n${items}`;

    const result = compactAriaSnapshot(snapshot, false);

    expect(result).toContain('link "Keep 0"');
    expect(result).toContain('link "Keep 5"');
    expect(result).toContain('link "Keep 9"');
    expect(result).not.toContain('omitted');
  });

  it.each([
    ['- button "Plain" [ref=e10]', 'ref=e10'],
    ['- button "Active" [active] [ref=e13]', 'active ref=e13'],
    ['- button "Disabled" [disabled] [ref=e14]', 'disabled ref=e14'],
    ['- button "Pressed" [pressed] [ref=e15]', 'pressed ref=e15'],
    ['- button "Expanded" [expanded] [ref=e16]', 'expanded ref=e16'],
    ['- checkbox "Checked" [checked] [ref=e17]', 'checked ref=e17'],
    ['- button "Cursor" [ref=e18] [cursor=pointer]', 'cursor=pointer ref=e18'],
  ])('keeps every bracket group of %p', (snapshot, expected) => {
    expect(compactAriaSnapshot(snapshot, true)).toContain(`[${expected}]`);
  });

  it('reports a typed value as a typed change, not as add/remove churn', () => {
    const diff = diffAriaSnapshots('- textbox "Title"', '- textbox "Title": Bench probe');

    expect(diff.text).toBe(['ariaDiff:', '  typed:', '    - textbox "Title": empty -> "Bench probe"', '  added: []', '  removed: []'].join('\n'));
    expect(diff.count).toBe(1);
  });

  it('reports a value being replaced', () => {
    const diff = diffAriaSnapshots('- textbox "Title": Bench probe', '- textbox "Title": Bench probe renamed');

    expect(diff.text).toContain('- textbox "Title": "Bench probe" -> "Bench probe renamed"');
    expect(diff.count).toBe(1);
  });

  it('reports a value being cleared', () => {
    const diff = diffAriaSnapshots('- textbox "Search": shoes', '- textbox "Search"');

    expect(diff.text).toContain('- textbox "Search": "shoes" -> empty');
  });

  it('treats a whitespace-only value as empty', () => {
    expect(diffAriaSnapshots('- textbox "Title"', '- textbox "Title":    ').text).toBeNull();
  });

  it('reports an unchanged value as no diff at all', () => {
    expect(diffAriaSnapshots('- textbox "Title": same', '- textbox "Title": same').text).toBeNull();
  });

  it('reports a typed value alongside a toggle in the same diff', () => {
    const before = ['- textbox "Title"', '- checkbox "Agree"'].join('\n');
    const after = ['- textbox "Title": Bench probe', '- checkbox "Agree" [checked]'].join('\n');

    const diff = diffAriaSnapshots(before, after);

    expect(diff.text).toContain('typed:');
    expect(diff.text).toContain('- textbox "Title": empty -> "Bench probe"');
    expect(diff.text).toContain('toggled:');
    expect(diff.text).toContain('- checkbox "Agree": unchecked -> checked');
    expect(diff.count).toBe(2);
  });

  it('keeps a genuinely new field as added rather than typed', () => {
    const diff = diffAriaSnapshots('- textbox "Title"', ['- textbox "Title"', '- textbox "Emoji": x'].join('\n'));

    expect(diff.text).toContain('added:');
    expect(diff.text).toContain('textbox "Emoji": x');
    expect(diff.text).not.toContain('typed:');
  });

  it('excerpts a long typed value instead of printing it whole', () => {
    const long = 'x'.repeat(5000);
    const diff = diffAriaSnapshots(`- textbox "Editor": ${long}`, `- textbox "Editor": ${long}y`);

    expect(diff.text).toContain('(5000 chars)');
    expect(diff.text).toContain('(5001 chars)');
    expect(diff.text!.length).toBeLessThan(400);
  });

  it('truncates a long value and references the file the caller stored it in', () => {
    const long = 'x'.repeat(5000);
    const stored: string[] = [];

    const out = compactAriaSnapshot(`- textbox "Editor": ${long}`, true, (value) => {
      stored.push(value);
      return 'abc123/value-deadbeef.txt';
    });

    expect(out).toContain('(5000 chars) [Full Text: abc123/value-deadbeef.txt]');
    expect(out.length).toBeLessThan(600);
    expect(stored[0]).toBe(long);
  });

  it('truncates a long value with a char count when no store is given', () => {
    const out = compactAriaSnapshot(`- textbox "Editor": ${'y'.repeat(5000)}`, true);

    expect(out).toContain('(5000 chars, truncated)');
    expect(out).not.toContain('[Full Text:');
    expect(out.length).toBeLessThan(600);
  });

  it('leaves a short value inline', () => {
    expect(compactAriaSnapshot('- textbox "Name": Bench probe', true)).toContain(': Bench probe');
  });

  it('keeps refs on stateful nodes nested in a tree', () => {
    const snapshot = ['- navigation "Panel sections" [ref=e6]:', '  - button "Workspace" [ref=e10]', '  - button "Workflows" [active] [ref=e13]'].join('\n');

    const result = compactAriaSnapshot(snapshot, true);

    expect(result).toContain('ref=e10');
    expect(result).toContain('ref=e13');
  });

  it('reads an ARIA locator written with the name key, as CodeceptJS resolves it', () => {
    expect(parseAriaLocator("{ role: 'checkbox', name: 'Select test or suite' }")).toEqual({ role: 'checkbox', text: 'Select test or suite' });
    expect(parseAriaLocator("{ role: 'button', text: 'Save' }")).toEqual({ role: 'button', text: 'Save' });
  });

  it('rejects a key that carries no accessible name', () => {
    expect(parseAriaLocator("{ role: 'button', aria-label: 'Close' }")).toBeNull();
  });
});
