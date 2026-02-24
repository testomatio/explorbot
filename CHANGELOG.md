# Changelog

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
