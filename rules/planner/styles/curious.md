Detect new valid paths that previous tests missed. Prioritize mining experience and research together before inventing abstract scenarios.

When <previously_tested_flows> is present, treat it as the ground truth for what already worked:
- List items under Successful Flow describe the path that was executed
- Lines in blockquotes (lines starting with >) are discoveries: extra fields, side panels, conditional UI, inputs called out during that run
Infer what was never tried or only partially exercised from that material.

When <previously_tested_flows> is NOT present, use <tested_scenarios> as the ground truth instead.
Read the step lines for each test to understand which controls were actually interacted with.
Identify elements from <page_research> that appear in NO test steps — these are coverage gaps.

Cross-read with <page_research>: for each form and Extended Research subsection, compare against those flows. Which text inputs, selects, checkboxes, toggles, and side controls were skipped or touched once with a single value? Prefer filling those gaps over repeating the same path.

The Type column in <page_research> tables shows the ARIA role of each element.
Cross-reference these types with the steps listed in <tested_scenarios> or <previously_tested_flows>:

Coverage gaps to look for:
- Input controls (textbox, textarea, spinbutton) that were never filled, or only filled with one kind of value
- Selection controls (combobox, listbox, radio group) where only one option was ever chosen
- Toggle controls (checkbox, switch) that were never toggled, or only tested in one state
- Expandable sections, disclosure widgets, accordions that were never opened
- Action buttons that were never clicked as part of a complete workflow
- Dependent UI: controls that appear or change based on another control's value

When proposing tests for forms, prefer filling ALL visible fields — not just required ones.
Vary input strategies: try short values, multi-word values, edge-of-valid values.
When a form has sections, tabs, or conditional panels, propose tests that exercise each section.
If a control has downstream effects (e.g., selecting a type reveals extra fields), build a test around that interaction chain.

Combinatorial coverage (valid data only):
- For each select or equivalent, ensure each option is exercised in at least one scenario, or one scenario whose steps walk through distinct options in sequence if that fits the task constraints better
- Exercise each checkbox or binary control in both states when behavior can differ
- Combine checkboxes and related toggles in small sets (pairs or triples) when they plausibly change validation, visible sections, or outcomes — avoid exploding into huge Cartesian products

When heavy forms are not the focus, still pursue: unvisited state transitions, follow-ups after creates (share, export, duplicate), alternative routes to the same goal, preconditions that unlock UI, and visible controls never clicked.

Skip the Menu/Navigation section — we are testing THIS page.
