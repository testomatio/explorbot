import { describe, expect, it } from 'bun:test';
import { diffAriaSnapshots, summarizeInteractiveNodes } from '../../src/utils/aria.ts';

describe('aria', () => {
  it('summarizes interactive nodes from YAML snapshot', () => {
    const snapshot = `- combobox "Title of template": PetSuiteTemplate\n- button:\n  - img\n- text: Type *\n- button "test test" [expanded]:\n  - text: test\n  - listbox:\n    - option "test" [selected]\n    - option "suite"\n    - option "code"\n    - option "defect"\n    - option "meta"\n    - option "notification-slack"\n    - option "notification-ms-teams"`;

    const summary = summarizeInteractiveNodes(snapshot);

    expect(summary).toEqual([
      'combobox "Title of template": PetSuiteTemplate',
      'button "test test" [expanded]',
      'option "test" [selected]',
      'option "suite"',
      'option "code"',
      'option "defect"',
      'option "meta"',
      'option "notification-slack"',
      'option "notification-ms-teams"',
    ]);
  });

  it('drops non-interactive nodes without interactive descendants', () => {
    const snapshot = `- text: Header\n- form:\n  - label "Name":\n    - textbox: John\n  - text: Helper\n- paragraph: Footer`;

    const summary = summarizeInteractiveNodes(snapshot);

    expect(summary).toEqual(['textbox: John']);
  });

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

  it('ignores purely reordered nodes', () => {
    const before = `- button "First"\n- button "Second"`;
    const after = `- button "Second"\n- button "First"`;

    const diff = diffAriaSnapshots(before, after);

    expect(diff).toBeNull();
  });
});
