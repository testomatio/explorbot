# Input Readline Plan

## Web Research Summary

- ink-text-input (vadimdemedes/ink-text-input) provides a single-line input with cursor navigation and paste highlighting. It does not include history or multiline editing.
- ink-multiline-input (ByteLandTechnology/ink-multiline-input) provides multiline editing, cursor navigation, scrolling, and configurable key bindings. It does not include command history or word navigation.
- No Ink-specific readline implementation with full history + word navigation + multiline was found in common packages.

## Proposed Direction

Add a new component `InputReadline` that is feature-flagged and can be toggled on without removing the existing `InputPane` behavior.

## Feature Flag

- Use environment flag `FEATURE_READLINE=true` to enable the new component.
- Default stays on the current `InputPane` when the flag is not set.

## InputReadline Behavior

- Paste
  - Accept multi-character input strings from Ink `useInput`.
  - Strip bracketed paste markers if present.
  - Insert newlines into the buffer.
- Word navigation
  - Ctrl+Left and Ctrl+Right jump by word boundary.
  - Also support Alt+B / Alt+F for terminals that do not emit Ctrl+Arrow.
- History
  - Up/Down navigate history when autocomplete is not visible.
  - Preserve an in-progress draft and restore it when leaving history.
  - Avoid duplicates by not pushing the same command consecutively.
- Multiline
  - Shift+Enter inserts newline.
  - Enter submits.
  - Render input with line wrapping and cursor position based on line/column.

## Autocomplete Interaction

- When autocomplete is visible, Up/Down continue to move the selection.
- History navigation is inactive while autocomplete is visible.
- Tab accepts the highlighted suggestion.

## Implementation Steps

1. Add `InputReadline` component under `src/components`.
2. Use the feature flag in the TUI container to select `InputPane` or `InputReadline`.
3. Keep `InputPane` unchanged for safety.
4. Reuse existing autocomplete data source and rendering.

## Safety and Regression Plan

- Add a small input reducer or helper for editing rules and test it with Bun unit tests.
- Manual checklist for TUI:
  - Enter submits single-line input.
  - Autocomplete shows and accepts via Tab.
  - Paste a full command and verify cursor and submission.
  - History navigation works when autocomplete is hidden.
  - Multiline: Shift+Enter inserts a newline, Enter submits.

## Open Questions

- None.
