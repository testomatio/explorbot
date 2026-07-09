# Planning Styles

A planning style is a markdown rule file that shapes what scenarios get planned. The whole file becomes the planning approach in the agent's prompt — written as instructions to a QA engineer on how to think about test scenarios.

Two agents use styles through the same mechanism: the web [Planner](../web-testing/planner.md) and the API [Chief](../api-testing/overview.md).

## Built-in Styles

Bundled style files live in `rules/planner/styles/` (web) and `rules/chief/styles/` (API):

| Style | Intent |
|-------|--------|
| `normal` | Complete user workflows: CRUD and full commit flows that end in a data or state change |
| `curious` | Coverage gaps: mines previous test results and research to find paths earlier tests missed |
| `psycho` | Stress tests: feeds empty, invalid, and extreme values to every reachable control, then commits |
| `hacker` | API only: probes beyond the spec — hidden endpoints, undocumented fields, unprotected actions |

## Cycling

Each planning iteration uses the next style in the list, cycling by index.

**Web Planner** — default order is `normal`, `curious`, `psycho`. The first `/plan` uses normal, the second curious, the third psycho, then the cycle repeats. Override the list and order with the `styles` option in [Planner configuration](../web-testing/planner.md#configuration); a name may appear more than once.

**API Chief** — order is `normal`, `curious`, `psycho`, `hacker`. `api plan` cycles them the same way. `api explore` doesn't cycle: it runs every style once, generating and executing a plan per style.

## Selecting a Style

Force a style for a single run:

```bash
npx explorbot plan /users --style psycho        # web
npx explorbot api plan /users --style hacker    # API
```

The web TUI accepts the same flag: `/plan --style psycho`. `api explore` has no `--style` flag — it always runs all styles.

## Custom Styles

Styles load from `rules/<agent>/styles/<name>.md` in your project first, falling back to the bundled file of the same name. To edit built-in styles, copy the bundled rules into your project:

```bash
npx explorbot extract-rules planner   # or: chief
```

This copies the agent's bundled rule files (including styles) to `./rules/<agent>/`, skipping files that already exist. Edit the copies — they take precedence over the bundled versions. Extract only what you want to change; anything you delete falls back to the bundled file.

Style files are plain markdown with no frontmatter. Write the mindset, the patterns to test, what counts as a test, and what to skip.

To add a new web style, create `rules/planner/styles/<name>.md` and add its name to the rotation:

```javascript
ai: {
  agents: {
    planner: {
      styles: ['normal', 'curious', 'psycho', 'security'],
    },
  },
}
```

The API Chief has no `styles` config option — customize it by overriding the built-in style files in `rules/chief/styles/`.

## See Also

- [Planner](../web-testing/planner.md) — how web test plans are generated
- [API Testing](../api-testing/overview.md) — the Chief agent and API commands
- [Test Plans](./test-plans.md) — the plan file format
