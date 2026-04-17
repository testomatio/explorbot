Detect new valid paths that previous tests missed. Prioritize mining experience and research together before inventing abstract scenarios.

Rank every scenario you build by the **strength of its outcome**, from strongest to weakest:
1. **Data change** — the backend, storage, or persisted state registers a difference (a record is created, edited, or deleted; a setting is persisted; a message is sent; a job is triggered; an item is shared or exported).
2. **State change** — the application moves to a different addressable or remembered state (route or URL change, a filter or sort actually applied to real data, a mode or auth change that the application remembers, the page showing a different underlying dataset).
3. **UI change only** — a control opens, closes, is cancelled, is dismissed, is hovered, is toggled for display only, or the view expands/collapses without the application registering anything new.

Prefer scenarios whose ending falls into category 1. Propose a category 2 scenario when no category 1 outcome is reachable for the control under test. Propose a category 3 scenario last, and only when the UI-only behaviour itself has a verifiable side effect worth checking (a warning prompt, a persisted draft, a state rollback, a badge appearing). A page may expose several paths that reach a data or state change — different buttons, different menus, different keyboard shortcuts, different confirmation flows. Pick whichever path reaches category 1 or 2; do not assume a single "primary action" exists.

When <previously_tested_flows> is present, treat it as the ground truth for what already worked:
- List items under Successful Flow describe the path that was executed
- Lines in blockquotes (lines starting with >) are discoveries: extra fields, side panels, conditional UI, inputs called out during that run
Infer what was never tried or only partially exercised from that material.
DO NOT re-propose these flows or reword them into new scenarios. They are already covered.
Instead, use the discoveries (lines starting with >) as leads for NEW tests around elements that were revealed but never interacted with.

When <previously_tested_flows> is NOT present, use <tested_scenarios> as the ground truth instead.
Read the step lines for each test to understand which controls were actually interacted with.
Identify elements from <page_research> that appear in NO test steps — these are coverage gaps.

Cross-read with <page_research>: for each section and Extended Research subsection, compare against those flows. Which text inputs, selects, checkboxes, toggles, and side controls were skipped or touched once with a single value? Prefer filling those gaps over repeating the same path.

The Type column in <page_research> tables shows the ARIA role of each element.
Cross-reference these types with the steps listed in <tested_scenarios> or <previously_tested_flows>:

Coverage gaps to look for:
- Input controls (textbox, textarea, spinbutton) that were never filled, or only filled with one kind of value
- Selection controls (combobox, listbox, radio group) where only one option was ever chosen
- Toggle controls (checkbox, switch) that were never toggled, or only tested in one state
- Expandable sections, disclosure widgets, accordions that were never opened
- Action buttons that were never clicked as part of a complete workflow
- Dependent UI: controls that appear or change based on another control's value

A coverage gap for an untested control is only **closed** when the scenario built around it reaches a data change or state change. A scenario that exercises the untested control but ends in a UI-only outcome does not close the gap — the application never registered the variation, so nothing distinguishes that scenario from not running it at all.

Exercising an untested control and testing a UI-only dismissal (cancel, close, navigate away, discard) are **two different categories of scenario**. Do not merge them by appending a dismissal ending to a variation scenario — the variation loses its value because the system never receives it. A dismissal or UI-only ending deserves its own dedicated scenario only when that dismissal itself has a verifiable side effect.

When multiple inputs or configurable controls contribute to the same outcome, prefer scenarios that configure **several of them together** before triggering the data or state change, rather than touching one control in isolation and ending there.
Vary input strategies: try short values, multi-word values, edge-of-valid values.
When sections, tabs, or conditional panels exist, exercise each section.
When a control has downstream effects (selecting one option reveals extra fields, toggling one setting enables another), build the scenario around that interaction chain — and still end it in a data or state change.

Combinatorial coverage (valid data only):
- For each select or equivalent, ensure each option is exercised in at least one scenario, or one scenario whose steps walk through distinct options in sequence if that fits the task constraints better
- Exercise each checkbox or binary control in both states when behavior can differ
- Combine checkboxes and related toggles in small sets (pairs or triples) when they plausibly change validation, visible sections, or outcomes — avoid exploding into huge Cartesian products

Each proposed combination must be exercised in a scenario that reaches a data change or state change. Combinations that only change the UI and never reach a registerable outcome do not count as coverage — the system never distinguishes them from each other.

When the page is not heavy on inputs, still pursue: unvisited state transitions, follow-ups after data-changing operations (share, export, duplicate, re-open), alternative paths to the same data change, preconditions that unlock new data-changing actions, and visible controls never clicked. Again, prioritise scenarios whose ending falls into category 1 or 2.

Skip the Menu/Navigation section — we are testing THIS page.
