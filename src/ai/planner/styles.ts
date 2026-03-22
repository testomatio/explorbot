import dedent from 'dedent';
import { ConfigParser } from '../../config.ts';

const BUILT_IN_STYLES: Record<string, string> = {
  normal: dedent`
    Study the page and figure out its business purpose. What is this page FOR? What would a user come here to do?

    Based on the page type, propose tests for COMPLETE user workflows:
    - If this is a data page (lists, tables): test CRUD operations end-to-end (create item → verify in list, edit item → verify changes saved, delete item → verify removed)
    - If this is a form page: test full submission flow, not just "form appears"
    - If this has filters and search: test filtering AND verify results change, not just "filter tab clicked"
    - If this has modals/dropdowns: test the ACTION inside them, not just opening/closing them

    Each test should end with the application in a different state than it started.

    IMPORTANT: Distribute tests across DIFFERENT feature areas from the research.
    Do not propose more than 2 tests for the same feature area.
    Every Extended Research section (modal, dropdown, panel) with actionable features deserves at least one test.
    Prioritize features with business actions (export, import, create, edit, delete) over simple UI interactions.

    Skip the Menu/Navigation section — we are testing THIS page.`,

  psycho: dedent`
    Stress-test the page by filling invalid, empty, and extreme values into every input.

    Focus on:
    - Empty states: submit forms with no data, clear required fields, remove default values
    - Long values: paste 10000 characters into inputs, use extremely long names and descriptions
    - Boundary values: zero, negative numbers, special characters, unicode, HTML tags in text fields
    - Invalid formats: wrong email formats, letters in number fields, SQL injection strings, script tags
    - Invalid combinations: select incompatible options, mix conflicting settings
    - Combining states: apply multiple filters at once, use conflicting form values together
    - Out-of-range values: dates in the past/future, quantities beyond limits, prices with too many decimals

    Push every input to its limits. Find what breaks when the form receives unexpected data.

    Skip the Menu/Navigation section — we are testing THIS page.`,

  curious: dedent`
    Detect new valid paths that previous tests missed. Prioritize mining experience and research together before inventing abstract scenarios.

    When <previously_tested_flows> is present, treat it as the ground truth for what already worked:
    - List items under Successful Flow describe the path that was executed
    - Lines in blockquotes (lines starting with >) are discoveries: extra fields, side panels, conditional UI, inputs called out during that run
    Infer what was never tried or only partially exercised from that material.

    Cross-read with <page_research>: for each form and Extended Research subsection, compare against those flows. Which text inputs, selects, checkboxes, toggles, and side controls were skipped or touched once with a single value? Prefer filling those gaps over repeating the same path.

    Combinatorial coverage (valid data only):
    - Aim to use every visible form control with a meaningful valid value, not only required fields
    - For each select or equivalent, ensure each option is exercised in at least one scenario, or one scenario whose steps walk through distinct options in sequence if that fits the task constraints better
    - Exercise each checkbox or binary control in both states when behavior can differ
    - Combine checkboxes and related toggles in small sets (pairs or triples) when they plausibly change validation, visible sections, or outcomes — avoid exploding into huge Cartesian products

    When heavy forms are not the focus, still pursue: unvisited state transitions, follow-ups after creates (share, export, duplicate), alternative routes to the same goal, preconditions that unlock UI, and visible controls never clicked.

    Skip the Menu/Navigation section — we are testing THIS page.`,

  performer: dedent`
    Think like a real user of this product. Anchor scenarios in experience and research so they reflect what the app already proved possible, then go deeper than the minimal path.

    Read <previously_tested_flows> when present: Successful Flow steps show proven paths; blockquote lines flag discoveries (optional fields, detail panels, follow-up actions). Pair that with <page_research> to find optional fields, metadata, tags, comments, attachments, and secondary actions the minimal flow skipped.

    Understand the business domain:
    - What is this application FOR? What real-world tasks do users accomplish with it?
    - What business features connect actions on this page to meaningful outcomes?
    - What are the user's main goals when they land on this page?

    Prefer maximal realistic happy paths: fill required and optional fields, set meaningful non-default choices, then continue the story (open the created item, adjust attributes, add a comment or note, use related actions the UI exposes). One scenario per coherent feature chain — create with full data, open, enrich, verify persistence or clear UI feedback — rather than stopping after the first required field validates.
    If form can expand to more fields expand it to at least 3 different fields.
    If a form has variable fields, fill at least 3 different values for each field.

    When the same action applies to multiple similar items, apply it to at least three items. Scenarios may span multiple pages when the feature naturally requires it; do not force navigation away from the page under test.

    Each scenario should read like a user story: "As a user, I want to accomplish X" where X is a real business outcome, not a single control click.
    Focus on core workflows and features that matter most to the business.`,
};

export function getStyles(): Record<string, string> {
  const configStyles = ConfigParser.getInstance().getConfig().ai?.agents?.planner?.styles || {};
  return { ...BUILT_IN_STYLES, ...configStyles };
}

export function getActiveStyle(iteration: number, override?: string): { name: string; approach: string } {
  const styles = getStyles();
  const names = Object.keys(styles);

  if (override) {
    const approach = styles[override];
    if (!approach) throw new Error(`Unknown planning style: "${override}". Available: ${names.join(', ')}`);
    return { name: override, approach };
  }

  const idx = iteration % names.length;
  const name = names[idx];
  return { name, approach: styles[name] };
}
