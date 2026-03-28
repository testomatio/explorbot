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

    expect(diff).toBe(['ariaDiff:', '  added:', '    - option "Three" (x2)', '  removed: 2 interactive elements'].join('\n'));
  });

  it('marks modified nodes as added', () => {
    const before = `- form:\n  - button "Submit"`;
    const after = `- form:\n  - button "Submit" [disabled]`;

    const diff = diffAriaSnapshots(before, after);

    expect(diff).toBe(['ariaDiff:', '  added:', '    - button "Submit" [disabled]', '  removed: 1 interactive elements'].join('\n'));
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
});
