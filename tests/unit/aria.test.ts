import { describe, expect, it } from 'bun:test';
import { compactAriaSnapshot, diffAriaSnapshots } from '../../src/utils/aria.ts';

describe('aria', () => {
  it('returns null diff for identical snapshots', () => {
    const snapshot = `- button "Save"\n- listbox:\n  - option "One"`;

    const diff = diffAriaSnapshots(snapshot, snapshot);

    expect(diff).toBeNull();
  });

  it('produces YAML diff with counts', () => {
    const before = `- listbox:\n  - option "One"\n  - option "Two"\n  - option "Two"`;
    const after = `- listbox:\n  - option "Two"\n  - option "Three"\n  - option "Three"`;

    const diff = diffAriaSnapshots(before, after);

    expect(diff).toBe(['ariaDiff:', '  added:', '    - option "Three" (x2)', '  removed:', '    - option "One"', '    - option "Two"'].join('\n'));
  });

  it('marks modified nodes as added', () => {
    const before = `- form:\n  - button "Submit"`;
    const after = `- form:\n  - button "Submit" [disabled]`;

    const diff = diffAriaSnapshots(before, after);

    expect(diff).toBe(['ariaDiff:', '  added:', '    - button "Submit" [disabled]', '  removed:', '    - button "Submit"'].join('\n'));
  });

  it('truncates added/removed sections to top 10 with overflow summary', () => {
    const before = Array.from({ length: 12 }, (_, i) => `- button "Old${i}"`).join('\n');
    const after = Array.from({ length: 12 }, (_, i) => `- button "New${i}"`).join('\n');

    const diff = diffAriaSnapshots(before, after);

    expect(diff).not.toBeNull();
    const dashLines = (diff!.match(/^ {4}- /gm) || []).length;
    expect(dashLines).toBe(20);
    const overflowLines = diff!.match(/^ {4}\+ 2 more interactive elements$/gm) || [];
    expect(overflowLines.length).toBe(2);
    expect(diff).toContain('  added:');
    expect(diff).toContain('  removed:');
  });

  it('ignores purely reordered nodes', () => {
    const before = `- button "First"\n- button "Second"`;
    const after = `- button "Second"\n- button "First"`;

    const diff = diffAriaSnapshots(before, after);

    expect(diff).toBeNull();
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
});
