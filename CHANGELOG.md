# Changelog

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
- [Researcher] Added `closeModal` tool — dismisses overlays (dropdowns, modals, popups) using progressive escalation: body click, Escape key, page reload
- [Planner] Plans now auto-load from existing plan files instead of always starting fresh
- [Planner] Improved duplicate detection: groups existing tests by feature keywords to prevent re-proposing similar scenarios
- [Planner] Extended Research sections (modals, dropdowns, panels) are now treated as separate feature areas for planning
- [Pilot] New `ATTACH_SUMMARY` context option for lightweight page overview without full UI map
- State Manager: Detects modal/dialog appearance as a state change even when page hash hasn't changed
- Experience Tracker: Truncates long experience entries to configurable line limit
- Locator rules updated: `:contains()` replaced with `:has-text()` for Playwright compatibility
- Locator rules updated: icon-only buttons/links now use partial href and SVG icon class selectors instead of requiring text
- Click tool now auto-wraps plain text arguments as `I.click("text")` commands
