# Changelog

## 2026-04-02

### Configuration
- **`api.baseEndpoint`** — Base URL for API requests used by the Fisherman agent. Default: same as `playwright.url`.
- **`api.spec`** — Array of OpenAPI spec file paths or URLs. Fisherman uses these to learn request formats before making API calls.
- **`api.headers`** — Custom headers to include in all API requests (e.g., API keys, auth tokens).
- **`ai.agents.fisherman`** — Configuration for the Fisherman agent. Set `enabled: true` to activate without full API config.

### Changes
- [Fisherman] New agent that prepares test data via API requests before tests run. Automatically discovers endpoints from captured XHR traffic or OpenAPI specs, authenticates using browser cookies, and creates items needed by test scenarios.
- [Pilot] Now calls `precondition()` before each test to declare what data must exist. When Fisherman is available, data is created automatically via API; otherwise preconditions are noted for manual setup.
- [Captain] Completes commands faster — after a successful action, if the page diff confirms the goal, finishes immediately instead of running extra verification steps.
- [Navigator] Rules for output format, multiple locators, and verification actions moved from inline code to external markdown rule files under `rules/navigator/`.
- [Researcher] Rules for UI map tables, section maps, screenshot maps, and list element indexing moved to external rule files under `rules/researcher/`.
- [Planner] When a feature focus is specified, all proposed scenarios must relate directly to it. Feature directive is now injected into the system message for stronger adherence.
- [Explorer] Automatically captures XHR/fetch write requests (POST, PUT, PATCH, DELETE) from the browser. Captured requests are saved to `output/requests/` and used by Fisherman to discover API endpoints and auth headers.
- Explore command now saves multi-plan output correctly — each sub-page plan is preserved as a separate suite in the saved markdown file, and results table shows which plan each test belongs to.
- TUI autocomplete redesigned — now shows descriptions alongside commands, displays argument hints after typing a command, supports fuzzy/substring matching, and uses cursor-aware replacement instead of replacing the full input line.
- TUI input now supports Ctrl+A/E (home/end of line), Ctrl+W (delete word back), Ctrl+U/K (delete to line start/end), Ctrl+Delete (delete word forward), and Escape to dismiss autocomplete.

## 2026-03-31

### New CLI Commands
- **`explorbot plan:load <planfile> [index]`** — Display a saved plan file as a table, or view details of a specific test by index.
  ```bash
  explorbot plan:load plan.md            # show all tests in table
  explorbot plan:load plan.md 3          # show details for test #3
  ```
- **`explorbot shell <url> <command>`** — Navigate to a URL, execute a single CodeceptJS command, and exit. Useful for quick one-off browser interactions.
  ```bash
  explorbot shell /login "I.see('Welcome')"
  explorbot shell /dashboard "I.click('Settings')"
  ```

### New TUI Commands
- **`page.*` commands** — Execute raw Playwright page commands directly in TUI alongside existing `I.*` commands.
  ```
  page.click('.my-button')
  page.fill('#email', 'test@example.com')
  await page.locator('.item').count()
  ```

### Configuration
- **`ai.agents.researcher.errorPageTimeout`** — Seconds to wait for an error page to recover before giving up. Researcher retries with exponential backoff during this window. Default: `10`. Set to `0` to disable.
- **`reporter.html`** — Force HTML report generation even when Testomatio is configured. When set, reports are generated to both Testomatio and local HTML. Default: `false`.

### Changes
- [Researcher] Error pages now trigger a retry with exponential backoff instead of immediately returning an error — pages that load slowly or redirect are given time to recover
- [Researcher] Cached research results are now clearly marked as potentially stale, prompting refresh when issues are noticed
- [Researcher] UI map now requires every element with an `eidx` attribute to be included, even icon-only elements without text
- [Researcher] Sections can no longer be named "Focus" or "Focused" — they must describe their content (e.g., "Detail", "Modal", "Form")
- [Researcher] New "Focused section" detection — automatically identifies the user's primary interaction area (dialogs, main content) using AI declaration, ARIA analysis, and visual fallback. Focused sections are marked in research output.
- [Researcher] Deep analysis prioritizes expandable elements from the focused section and deduplicates expanded sections with the same container
- [Researcher] Deep analysis skips hover probing for coordinate-based clicks where hover would miss the target
- [Pilot] Verdict review now provides concrete guidance when requesting continuation — tells Tester exactly what to verify, retry, or complete next
- [Pilot] Session log now includes executed code, targeted element HTML, and skipped fallback attempts for each action — enabling detection of wrong-element clicks
- [Pilot] New detection rules for logically wrong successes: mismatched executed vs intended commands, text sent to wrong elements, and unrelated ARIA changes after actions
- [Pilot] Navigation awareness — compares current URL to start URL and flags suspicious outer-page or outer-site navigation
- [Pilot] Already-achieved state detection — recognizes when the scenario goal is already met and adapts instead of repeating the same action
- [Pilot] Complex component guidance — instructs Tester on search-and-select dropdown sequences and generic trigger mismatches
- [Pilot] Removed standalone verification via Navigator — continuation guidance now directs Tester to verify within the test flow
- [Planner] Focused research sections are highlighted to concentrate test generation on the user's primary interaction area first
- [Planner] Previously tested flows are now presented with discovery annotations, and curious style avoids re-proposing covered flows
- [Planner] Normal style now considers re-testing important previously tested flows for regression coverage with input variations
- [Tester] Click tool now enforces that all commands in the fallback array target the same element — mixing different elements in one click call is rejected
- [Tester] File paths in `<available_files>` are now relative to the project directory instead of absolute
- [Tester] Removed standalone final review — all test verdicts now go through Pilot
- [Tester] Major page changes (50+ ARIA elements added/removed) trigger a suggestion to check iframe content and HTML parts
- Click disambiguation now tries `elementIndex` option first before falling back to XPath, improving reliability with framework-rendered lists
- Explore command now shows test index numbers and source plan names in the results table, and prints the saved plan path with a re-run command
- Plan file loading improved — searches current directory before falling back to plans directory, and auto-appends `.md` extension
- [Explorer] Playwright `page.*` commands are now supported in the action executor alongside CodeceptJS `I.*` commands
- [Explorer] CodeceptJS steps and store listeners are now properly initialized, enabling `step.opts()` for element index selection

## 2026-03-29

### New CLI Options
- **`--max-tests <count>`** — Limit the number of tests to run during exploration or freesail. Stops after the specified count is reached.
  ```bash
  explorbot explore /dashboard --max-tests 5
  explorbot freesail /app --max-tests 10
  ```
- **`-a, --append`** — Add tests to an existing plan file instead of replacing it. Loads the saved plan before generating new scenarios.
  ```bash
  explorbot plan /login -a
  explorbot plan /login --append
  ```

### New CLI Commands
- **`explorbot extract-styles <agent>`** — Extract built-in planning styles to `rules/<agent>/styles/` for customization. Edit the generated markdown files to change how the Planner generates test scenarios.
  ```bash
  explorbot extract-styles planner              # extracts to rules/planner/styles/
  explorbot extract-styles planner -d ./styles  # custom target directory
  ```
- **`explorbot add-rule [agent] [name]`** — Create a rule file for an agent. Opens an interactive TUI form when called without arguments.
  ```bash
  explorbot add-rule researcher check-tooltips
  explorbot add-rule tester wait-for-toasts --url '/admin/*'
  explorbot add-rule                              # interactive mode
  ```

### New TUI Commands
- **`/rules:add`** (alias: `/add-rule`) — Create a rule file for an agent interactively from TUI.
  ```
  /add-rule researcher check-tooltips
  /rules:add tester slow-forms
  ```
- **`/explore --max-tests <n>`** — Limit the number of tests during exploration.
  ```
  /explore --max-tests 5
  ```
- **`/freesail --max-tests <n>`** — Limit the number of tests during autonomous exploration.
  ```
  /freesail --max-tests 10
  /freesail --deep --max-tests 20
  ```

### Configuration
- **`ai.agents.<name>.rules`** — Load markdown rule files per agent from `rules/<agent>/` directory. Supports URL-pattern matching for page-specific rules. Default: `[]`.
- **`ai.agents.planner.styles`** — Now takes an array of style names (e.g., `['normal', 'curious', 'psycho']`) instead of a key-value map. Styles are loaded from `rules/planner/styles/` as markdown files.
- **`reporter.enabled`** — Enable HTML test reports without requiring Testomatio. Generates reports to `output/reports/`. Default: `false` (enabled automatically when `TESTOMATIO` env var is set).

### Changes
- [Tester] Pilot can now extend test execution up to 2 additional rounds when the initial iteration limit is reached but the test is not yet complete
- [Tester] Tests are stopped after 5 consecutive empty AI responses instead of running until max iterations
- [Pilot] "Skipped" verdict now also covers systematic execution failures (repeated LLM errors, tool crashes unrelated to the scenario)
- [Pilot] Only the last few actions before finish/stop are considered verification evidence — older verify results are ignored
- [Pilot] Test summaries no longer start with "scenario goal achieved/not achieved" — they describe what happened
- [Pilot] Prefers exploring the current page before suggesting navigation to another page
- [Planner] Default style order changed to normal → curious → psycho (curious now runs before psycho)
- [Planner] Tests that create, update, or delete data are prioritized over UI-only interactions (view switching, filtering, pagination)
- [Planner] Experience flows are deduplicated and trimmed before planning — removes empty sections and limits blockquotes per section
- [Planner] `/plan --append` removed from TUI (use CLI `explorbot plan -a` instead)
- [Researcher] Similar pages reuse cached research via HTML fingerprint matching, skipping re-analysis when the page structure hasn't changed
- [Researcher] Error pages are detected early and short-circuited without running the full research pipeline
- [Researcher] Container CSS validation improved — multi-part selectors like `div.static nav` are simplified to their first segment; bare tag selectors are rejected
- [Navigator] Delayed redirects are now detected — waits 1 second and rechecks after initial navigation appears to fail
- [Historian] Test steps are verified by AI before saving to experience — filters out unstable locators, duplicates, and trivial navigation
- [Historian] Generated CodeceptJS code is saved for all test results (not just successful ones)
- [Reporter] HTML reports generated locally when `reporter.enabled` is true, even without a Testomatio account
- [Reporter] Last screenshot is attached to the final test step in reports
- Click and form tools now auto-disambiguate when multiple elements match — uses AI to pick the correct element by XPath
- Planning styles moved from hardcoded code to `rules/planner/styles/` markdown files — extract and edit them with `explorbot extract-styles planner`

## 2026-03-22

### New CLI Commands
- **`explorbot api plan <endpoint>`** — AI-powered API testing. Generate test plans for API endpoints and execute them.
  ```bash
  explorbot api init                          # initialize API testing project
  explorbot api plan /users                   # generate test plan for endpoint
  explorbot api plan /users --style curious   # use a specific planning style
  explorbot api test plan.md                  # run tests from plan
  explorbot api test plan.md 1-3             # run specific tests
  explorbot api know /users "CRUD endpoint"  # add API knowledge
  ```

### New TUI Commands
- **`/debug`** — Toggle debug output on/off during a session.
  ```
  /debug
  ```

### Configuration
- **`ai.model`** — Now accepts Vercel AI SDK model instances directly (e.g., `groq('gpt-oss-20b')`) instead of requiring separate `ai.provider` and `ai.model` string. This enables mixing providers for different agents.
- **`experience.maxReadLines`** — Default increased from `50` to `100`.

### Changes
- [Provider] Simplified configuration — pass model instances directly instead of separate provider function and model string. `ai.provider` is no longer required. Each agent can use a model from a different provider
- [Provider] Multi-level context reduction on overflow — progressively trims tagged content, then compacts middle messages, instead of a single trim attempt
- [Tester] New `back()` tool to navigate to the previous page when accidentally navigated to a wrong page
- [Tester] New `exitIframe()` tool to leave iframe context instead of calling `I.switchTo()` directly
- [Tester] Captain can now interrupt running tests to pass, fail, or skip them via supervisor mode
- [Tester] Click failures now show error-specific suggestions (element not found vs timeout/overlay) and list matched elements when multiple are found
- [Tester] Visual confirmation from `see()` is now valid evidence for test results
- [Tester] `verify()` checks per-assertion duplicates instead of blocking all verifications after the first one
- [Tester] Pilot review triggers after 3 consecutive failures instead of only at fixed iteration intervals
- [Tester] Experience from previous sessions is now included in test execution context
- [Pilot] New "skipped" verdict for tests where the feature does not exist on the page
- [Pilot] Session log now groups actions by URL with page headings for clearer context
- [Pilot] Visual analysis from screenshots is now considered strong evidence for UI state
- [Pilot] Scenario goal takes priority over individual milestones when deciding pass/fail
- [Planner] Automatically discovers and plans tests for related sub-pages after the main page
- [Planner] Scenarios already tested in previous planning rounds are skipped (session deduplication)
- [Planner] Stricter test independence — workflows are never split into multiple tests
- [Researcher] UI map now includes `eidx` column for element index references
- [Researcher] Elements with hover interactions (tooltips, popovers, submenus) are now detected and marked
- [Researcher] Deep analysis filters expandable elements using AI when there are many candidates, and probes elements for hover-triggered UI
- [Historian] Detects retry patterns in test sessions and saves successful resolutions to experience automatically
- [Captain] Refactored with idle mode — includes bash tool, file access, and diagnostic capabilities
- [Explorer] Tests can now be marked as "skipped" with proper event reporting
- TUI: New plan pane shows completed and active plan progress with pass/fail/skip counts
- TUI: Skipped tests shown in yellow with strikethrough in task list
- Rules: `I.moveCursorTo` documented for triggering hover effects (tooltips, dropdown menus, preview cards)
- Rules: Popup dismissal now uses `I.clickXY(0, 0)` instead of `I.click('//body')`

## 2026-03-17

### New CLI Options
- **`--style <style>`** — Set the planning style when generating test plans. Available styles control how aggressively scenarios are invented.
  ```bash
  explorbot plan /login --style curious
  explorbot plan /dashboard --style psycho
  ```

### New CLI Commands
- **`explorbot test <planfile> [index]`** — Run specific tests by index, range, or all. Replaces the old `--all` and `--test` flags with a positional argument.
  ```bash
  explorbot test plan.md 1           # run first test
  explorbot test plan.md 1-3         # run tests 1 to 3
  explorbot test plan.md 1,3,5       # run specific tests
  explorbot test plan.md *           # run all pending tests
  explorbot test plan.md all         # same as *
  ```

### New TUI Commands
- **`/plan --style <style>`** — Set planning style from TUI.
  ```
  /plan --style curious
  /plan authentication --style psycho
  ```
- **`/plan --clear`** — Clear the current plan and immediately create a new one (combines `/plan:clear` + `/plan`).
  ```
  /plan --clear
  /plan --clear authentication
  ```
- **Plan Editor: `Del` key** — Remove a test from the plan in the plan editor (Ctrl+E).

### Configuration
- **`playwright.waitForAction`** — Delay in ms after each Playwright action. Default: `500`.
- **`ai.agents.planner.styles`** — Custom planning styles as a key-value map of style name to approach prompt.

### Changes
- [Planner] Planning now cycles through multiple styles (normal, curious, psycho) during exploration to generate diverse test scenarios
- [Planner] Coverage analysis runs after each planning session, automatically exploring sub-pages with low coverage
- [Pilot] Now actively plans test execution before Tester starts, providing step-by-step guidance
- [Pilot] Reviews new pages during test execution, giving Tester updated guidance when navigating
- [Pilot] Verdict review is now synchronous — Pilot immediately decides pass/fail/continue instead of deferring
- [Pilot] Can request additional verification from Navigator when evidence is insufficient
- [Tester] Removed standalone `type()` and `select()` tools — use `form()` for all text input, dropdown selection, and file uploads
- [Tester] Screenshots are now automatically captured when actions cause page changes (ARIA diff or URL change)
- [Tester] `finish()` now delegates verification entirely to Pilot instead of running its own verify step
- [Researcher] Visual analysis now extracts page purpose and primary actions from annotated screenshots
- [Historian] ARIA diffs are condensed before sending to discovery analysis, reducing token usage
- Vision model failures are now handled gracefully — `see()` and `visualClick()` auto-disable for the session instead of failing repeatedly
- `verify()` prevents duplicate verifications on the same page state
- Context parameter (container) is now the preferred approach for all interaction commands (`I.fillField`, `I.selectOption`, `I.attachFile`)
- New verification commands documented: `I.seeInField()` and `I.dontSeeInField()` for checking input field values
- `.env` file is now automatically loaded from the working directory
- `explorbot plan` CLI now prints a summary with test list and example run commands
- Test duration is tracked and displayed in the exploration results table

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
