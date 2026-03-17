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

  curious: dedent`
    Detect new valid paths that previous tests missed. Use domain logic and UI clues to find untested workflows.

    Study the previous test results, experience, and notes carefully:
    - What forms were filled in? What values were used? What other valid values exist?
    - What states were visited? What transitions between states were NOT tried?
    - What domain-specific paths exist based on the business logic of this page?
    - What conditional UI appeared during previous tests that was never explored?
    - What links, buttons, or options were visible but never clicked?

    Investigate deeper:
    - Follow up on side effects of previous actions (e.g., after creating an item — can it be shared? exported? duplicated?)
    - Look for alternative valid workflows to reach the same goal
    - Find features that only appear after certain preconditions are met
    - Explore different user roles, permissions, or data states implied by the UI

    Skip the Menu/Navigation section — we are testing THIS page.`,

  psycho: dedent`
    Stress-test the page by combining states, using empty and extreme values, and abusing boundaries.

    Focus on:
    - Empty states: submit forms with no data, clear required fields, remove default values
    - Long values: paste 10000 characters into inputs, use extremely long names and descriptions
    - Combining states: apply multiple filters at once, open modal while another is open, edit while deleting
    - Boundary values: zero, negative numbers, special characters, unicode, HTML tags in text fields
    - Rapid state changes: create then immediately delete, edit then cancel, toggle same switch repeatedly
    - Invalid combinations: select incompatible options, mix conflicting settings, use expired or stale data
    - Interruption: navigate away mid-operation, close modal during save, refresh while submitting

    Push every input and interaction to its limits. Find what breaks when the UI is used in unexpected ways.

    Skip the Menu/Navigation section — we are testing THIS page.`,

  performer: dedent`
    Think like a real user of this product. What do they actually want to accomplish here?

    Study previous test results, visited pages, and experience to understand the business domain:
    - What is this application FOR? What real-world tasks do users accomplish with it?
    - What business features connect actions on this page to meaningful outcomes?
    - What would a user's goal be when they land on this page?

    Propose scenarios focused on business features from the user perspective:
    - What does the user want to achieve, not just what buttons exist
    - Chain actions that build on each other (create something, configure it, use it, verify the result)
    - Go beyond single UI interactions — test the feature as a whole, not individual controls
    - Scenarios may span multiple pages if the feature naturally requires it, but don't force navigation

    Each scenario should read like a user story: "As a user, I want to accomplish X" where X is a real business outcome, not a UI interaction.
    Focus on core workflows and features that matter most to the business.`,
};

export const EXPAND_PLAN_SUFFIX = dedent`
  Look at the research sections and find a feature area that has NO existing tests yet.
  Pick that ONE feature and test it thoroughly — happy paths, edge cases, error handling.

  Think like a user of this product:
  - What is the purpose of this feature?
  - What would I expect to happen when I use it?
  - What could go wrong?
  - What workflows does this feature enable?

  Look carefully at Extended Research sections — modals, dropdowns, and panels are often untested.
  Each is a separate feature area. Pick one and go deep.`;

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
