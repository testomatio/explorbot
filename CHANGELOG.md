# Changelog

## 2026-03-07

### Configuration
- **`files`** — Map of description-to-path entries for custom files to use in file upload tests. Default: `{}`.

### Changes
- [Tester] File upload support — Explorbot can now upload files using `I.attachFile()`. Built-in sample files (PNG, PDF, DOCX, XLSX, ZIP, MP4, MP3) are provided automatically. Custom files can be added via `files` config.
- [Tester] Automatically resets on 404/Not Found pages and records server errors (500, 503) before resetting.
- [Tester] Finish verification now requires assertions to prove that test actions actually changed the page, rejecting verifications of pre-existing state.
- [Pilot] Detects trivial verifications where the asserted state existed before the test started and rejects them.
- [Pilot] Uses `xpathCheck` proactively on first element-not-found failure instead of waiting for repeated failures.
- [Pilot] Verification details now include assertion pass ratio (e.g., "2 of 3 assertions passed").
- [Navigator] Verification now requires majority of assertions to pass (not just one) for multi-assertion checks.
- [Navigator] Assertions are now required to reference the specific item or value being verified, preventing false positives from generic locators.
- Type tool now detects when text was not actually entered (no page change after fillField) and suggests click-then-type fallback.
- Type and pressKey tools now check that an element is focused before attempting input, with clear error messages when nothing is focused.
- TUI task list auto-scrolls to the currently running test.
- Fixed Ctrl/Meta key combinations inserting characters in TUI input.

## 2026-03-06

### New CLI Options
- **`explorbot test <planfile>`** — Execute tests from a saved plan file without launching TUI.
  ```bash
  explorbot test plan.md --all              # run all pending tests
  explorbot test plan.md --test 3           # run test #3 only
  explorbot test plan.md --grep "login"     # run tests matching pattern
  ```

- **`explorbot browser start|stop|status`** — Manage a persistent browser server that survives across explorbot sessions. Commands automatically reuse it instead of launching a new browser each time.
  ```bash
  explorbot browser start --show     # launch visible browser
  explorbot browser start            # launch headless
  explorbot browser stop             # stop the server
  explorbot browser status           # check if running
  ```

### New TUI Commands
- **`/plan --append`** — Add more tests to an existing plan instead of replacing it.
  ```
  /plan --append
  /plan authentication --append
  ```
- **`/plan`** now warns if a plan already exists and suggests `--append`, preventing accidental overwriting.

- **`/plan-edit`** — Edit test plan interactively in TUI (enable/disable tests, reorder).
  ```
  /plan-edit
  ```

### Configuration
- **`ai.agenticModel`** — Model used for agentic tasks (Captain, Pilot verdict review). Falls back to default model. Default: none.
- **`ai.agents.<name>.providerOptions`** — Pass provider-specific options per agent. Default: `{}`.

### Changes
- [Researcher] Refactored into a 5-stage pipeline: Research → Test → AI Fix → Visual Analysis → Backfill. Broken locators are now fixed by continuing the same AI conversation (reusing context), instead of spawning new conversations per section
- [Researcher] Locator testing now captures exact match counts ("0 elements", "3 elements") instead of just pass/fail, giving AI better information for fixing
- [Researcher] XPath column removed from research prompts — AI no longer generates XPath locators. XPaths are backfilled automatically from the DOM only for elements with broken CSS and no ARIA
- [Researcher] Code split into mixins: locators, coordinates, deep-analysis, cache, parser, research-result
- [Captain] Now has diagnostic tools: inspect test sessions (logs, tool calls, ARIA states, pilot analysis), run TUI commands, read/write files, evaluate browser JS, manage tabs
- [Captain] Uses agentic model when configured, with richer system prompt covering diagnostic workflows
- [Captain] Max steps increased from 10 to 15
- [Pilot] Verdict review now weighs final observable state over intermediate failures — a test passes if the end state proves the goal, even when some steps failed
- [Pilot] "Continue" decisions now explain why the verdict was rejected and suggest untried approaches; feedback is sent back to Tester's conversation
- [Planner] Simplified page analysis for visited pages — uses URL+title instead of extracting ARIA elements, reducing token usage
- [Planner] Removed HTML content from planning prompt context, relying on research output instead
- [Planner] `getPendingTests()` now respects `test.enabled` flag
- [Test Command] `/test N` now selects from visible (enabled, unfinished) tests instead of all pending tests
- HTML diff now returns container-scoped parts instead of a single subtree — each changed area includes the CSS selector of its nearest stable container, helping the tester understand WHERE on the page changes occurred
- [Tester] Page diff suggestion now instructs AI to use container selectors from htmlParts as context when clicking
- ARIA snapshot capture and iframe HTML extraction now handle browser errors gracefully instead of crashing
- [Explorer] Browser error recovery (frame detached, target closed, session closed) added to locator count, eidx lookup, and container queries
- [Observability] Nested spans now work correctly when tracing is not fully initialized — allows sub-operations to appear in Langfuse traces
- Unexpected popup dismissal rule added to shared rules — agents now try clicking outside, pressing Escape, or clicking Cancel/Close when popups appear unexpectedly

## 2026-02-25

### Configuration
- **`ai.agents.researcher.sections`** — Pre-defined list of expected page sections. Researcher identifies these sections on each page, and planner proposes tests in this order. Sections: `focus` (modal, drawer, popup), `list` (items, table, cards), `detail` (selected item preview), `panes` (split screen), `content` (main area), `menu` (toolbar, context actions, filters), `navigation` (top bar, sidebar, breadcrumbs). Configurable to reorder or limit sections.

### Changes
- [Planner] New priority levels: `critical`, `important`, `high`, `normal`, `low` (replaced `high`/`medium`/`low`/`unknown`)
- [Planner] Tests are now proposed following research section order instead of being re-sorted by priority — content and detail sections are tested before menus and navigation
- [Planner] Maximum test count increased from 7 to 12, allowing broader coverage on feature-rich pages
- [Planner] Tests are distributed across different feature areas — no more than 2 tests per area, every Extended Research section with actions gets at least one test
- [Planner] When expanding a plan, only newly added tests are shown (not the full list repeated)
- [Planner] Plan files now include `<!-- plan updated on ... -->` timestamp comment when expanded
- [Researcher] Expandable element clicks are now wrapped in error handling to prevent a single failed click from stopping deep analysis
- [Researcher] Added `navigation` section type, separated from `menu` — `menu` is now page-local actions (toolbar, filters, dropdowns), `navigation` is site-wide navigation (top bar, sidebar, breadcrumbs)

## 2026-02-24

### New CLI Options
- **`explorbot freesail [startUrl]`** — Continuously explore and test pages autonomously. Explorbot navigates to new pages, researches them, runs tests, then moves on — indefinitely.
  ```bash
  explorbot freesail /admin           # start exploring from /admin
  explorbot freesail /dashboard --deep    # depth-first: explore nearby pages first
  explorbot freesail /app --shallow       # breadth-first: spread across many pages
  explorbot freesail /app --scope /admin  # only explore pages under /admin
  ```
- **`--deep`** — Depth-first exploration: prioritize newly discovered pages close to the current URL.
- **`--shallow`** — Breadth-first exploration: pick the globally least-visited page next.
- **`--scope <prefix>`** — Restrict autonomous navigation to URLs starting with the given prefix.

### New TUI Commands
- **`/freesail`** (alias: `/freeride`) — Start autonomous exploration from the current page inside TUI.
  ```
  /freesail
  /freesail --deep
  /freesail --shallow
  /freesail --scope /admin
  ```

### Changes
- [Researcher] Page sections are now visually marked with dashed colored borders on screenshots, with a Legend box in the bottom-right corner mapping colors to section names
- [Researcher] Missing elements are now detected and filled in before screenshot analysis, resulting in more complete visual data
- [Researcher] Broken section containers are fixed by AI before taking the annotated screenshot, so more sections appear in the visual output
- [Researcher] Screenshot file path is now printed after research completes for easy review
- [Context] `context --visual` now shows section container borders and legend when cached research is available
- [Pilot] Now makes the final pass/fail decision for tests — reviews Tester's verdict against actual evidence before accepting it
- [Pilot] Provides richer state context to diagnose failures: focused element, active form fields, disabled buttons, modal status, and open tabs
- [Pilot] Only uses tools when Tester has repeated failures, reducing unnecessary API calls
- [Navigator] Autonomous navigation now tracks visit counts per page and prefers least-visited pages instead of skipping all visited pages
- [Navigator] Validates that navigation targets are actual URL paths, preventing navigation to invalid destinations
- [Planner] Prioritizes testing features from Extended Research sections (modals, dropdowns, panels) that have no coverage yet
- [Tester] Deletion scenarios are now scoped — only items created by previous tests can be deleted, preventing accidental data loss
- File upload tests are no longer planned or attempted (Explorbot cannot upload files)
- [Quartermaster] A11y violation reports now include the affected HTML element for easier identification

## 2026-02-23

### New CLI Options
- **`--visual`** / **`--screenshot`** — Annotate interactive elements on screenshot with colored labels showing their index numbers, and print the screenshot file path.
  ```bash
  explorbot context /dashboard --visual
  explorbot context /login --screenshot
  ```

- **`--verbose`** / **`--debug`** on `research` — Print detailed debug logs during research (previously only available for `start` and `drill`).
  ```bash
  explorbot research /dashboard --verbose
  explorbot research /login --debug
  ```

- **`--incognito`** on `research` — Run research without reading or writing experience files (previously only available for `start` and `drill`).
  ```bash
  explorbot research /dashboard --incognito
  ```

### Changes
- [Researcher] Buttons, links, inputs and other interactive elements are annotated with `eidx` markers and highlighted with colored labels on screenshots, making it easier to see what was discovered
- [Researcher] Elements that AI missed during research are now automatically detected and listed in an "Other Elements" section
- [Researcher] Automatically retries research when page structure can't be parsed correctly
- `--session` no longer defaults to `output/session.json` — must be explicitly provided or used as a boolean flag

## 2026-02-18

### New CLI Options
- **`--session [file]`** — Save/restore browser session (cookies, localStorage, sessionStorage) to a JSON file. On next run the session is restored automatically, skipping login or setup steps.
  ```bash
  explorbot start /login --session                # uses default output/session.json
  explorbot start /dashboard --session auth.json  # custom session file
  explorbot research /app --session               # works with research command too
  explorbot context /app --session                # works with context command too
  ```

- **`--fresh`** — Start planning from scratch, ignoring any existing plan file for this page.
  ```bash
  explorbot plan /login authentication --fresh
  ```

- **`--no-fix`** — Skip locator fix cycle during research (useful for debugging).
  ```bash
  explorbot research /dashboard --no-fix
  ```

### New TUI Commands
- **`/plan --fresh`** — Re-plan from scratch, discarding the existing plan for current page.
  ```
  /plan --fresh
  /plan authentication --fresh
  ```

- **`/research --no-fix`** — Run research without the locator validation/fix cycle.
  ```
  /research --no-fix
  /research /dashboard --no-fix
  ```

### Configuration
- **`ai.agents.researcher.retries`** — Number of times researcher retries when >80% of locators are broken. Default: `2`.
- **`experience.maxReadLines`** — Maximum lines to read from each experience entry, truncating long entries. Default: `50`.

### Changes
- [Researcher] Now validates all locators against the live page after research, retrying automatically when most locators are broken
- [Researcher] Validates section container CSS selectors and removes broken ones
- [Researcher] Re-prompts AI when response cannot be parsed into the expected table format
- [Planner] Plans now auto-load from existing plan files instead of always starting fresh
- [Planner] Improved duplicate detection: groups existing tests by feature keywords to prevent re-proposing similar scenarios
- [Planner] Extended Research sections (modals, dropdowns, panels) are now treated as separate feature areas for planning
- [Pilot] New `ATTACH_SUMMARY` context option for lightweight page overview without full UI map
- State Manager: Detects modal/dialog appearance as a state change even when page hash hasn't changed
- Experience Tracker: Truncates long experience entries to configurable line limit
- Locator rules updated: `:contains()` replaced with `:has-text()` for Playwright compatibility
- Locator rules updated: icon-only buttons/links now use partial href and SVG icon class selectors instead of requiring text
- Click tool now auto-wraps plain text arguments as `I.click("text")` commands
