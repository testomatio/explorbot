# Planner Agent

The Planner agent turns Researcher findings into test scenarios. Each scenario has steps, expected outcomes, and a priority, ready for the Tester to run.

## Overview

When you run `/plan` or `/explore`, the Planner:

1. Receives the Researcher's UI map of the current page.
2. Applies a planning style.
3. Generates 3 to 12 scenarios with steps and expected outcomes.
4. Assigns priorities based on business importance.

Run it again and the Planner adds new scenarios in a different style. It skips scenarios that already exist.

## Configuration

```javascript
ai: {
  agents: {
    planner: {
      model: groq('gpt-oss-20b'),
      styles: ['normal', 'psycho', 'curious'],
      rules: [
        { '/checkout/*': 'payment-focus' },
      ],
    },
  },
}
```

### Options Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `model` | `LanguageModel` | default model | Override model for Planner |
| `styles` | `string[]` | `['normal', 'psycho', 'curious']` | Style names and cycling order |
| `stylesDir` | `string` | `rules/planner/styles/` | Custom directory for style files |
| `rules` | `RuleEntry[]` | `[]` | URL-aware rule files from `rules/planner/` |
| `systemPrompt` | `string` | - | Inline instructions appended to the prompt |

## Planning Styles

A style is a testing approach that shapes which tests the Planner creates. Styles cycle on each planning iteration, so repeated runs produce different kinds of tests.

### Built-in Styles

All three built-in styles rank scenarios by outcome strength, from strongest to weakest:

1. **Data change** — a record is created, edited, deleted; a setting is persisted; a message is sent; a job is triggered.
2. **State change** — a route change, a filter or sort applied to real data, a mode or auth change the app remembers.
3. **UI-only change** — something opens, closes, is cancelled, is hovered, or is toggled for display. The application registers nothing new.

The Planner prefers scenarios that end in category 1 or 2. It proposes category 3 only when the UI-only behaviour has a verifiable side effect, such as a warning prompt, a persisted draft, or a badge appearing.

| Style | Focus | What it generates |
|-------|-------|-------------------|
| **normal** | Complete user workflows | CRUD operations, full commit flows, filter+verify flows — each test ends in a data change or state change. UI-only tests (tab switching, pagination, view toggles) come last and only when data- and state-changing coverage is done. Distributes tests across feature areas. |
| **psycho** | Invalid and extreme inputs | Attacks **every reachable control in the same scenario** with a different strange value — empty, 10000 chars, unicode, SQL, script tags, invalid formats, conflicting toggles, out-of-range dates — then commits. Scenarios that enter bad data and cancel are rejected: the application never received the payload. |
| **curious** | Coverage gaps | Cross-references previous test results with page research to find untested controls. An untested control is only considered covered when the scenario built around it reaches a data or state change. Variation scenarios and dismissal/UI-only scenarios are kept separate — the planner will not merge them by appending a cancel at the end. |

### How Cycling Works

The default cycle is: normal, psycho, curious, then back to normal.

| Iteration | Style | Purpose |
|-----------|-------|---------|
| 1st `/plan` | normal | Cover core workflows and CRUD operations |
| 2nd `/plan` | psycho | Stress-test with invalid and extreme inputs |
| 3rd `/plan` | curious | Fill coverage gaps from previous iterations |
| 4th `/plan` | normal | Re-examine with fresh research |

Each iteration proposes only scenarios that aren't already in the plan. When all feature areas are covered, the Planner returns an empty list.

Force a specific style:

```
/plan --style psycho
```

### Customizing Styles

#### Extract and Edit

Extract the built-in styles to your project:

```bash
npx explorbot extract-rules planner
```

This creates:

```
rules/planner/styles/
  normal.md
  psycho.md
  curious.md
```

Edit any file to change how the Planner thinks. For example, edit `normal.md` to add domain-specific patterns, or `psycho.md` to add industry-specific invalid inputs.

Explorbot loads from your `rules/planner/styles/` first and falls back to the built-in files for any you didn't extract. Extract only the styles you want to change.

#### Create New Styles

Create `rules/planner/styles/security.md`:

```markdown
Focus on security-related scenarios:
- Test all inputs for XSS by entering <script> tags
- Check that sensitive data is masked in the UI
- Verify that unauthorized actions show proper error messages
- Test session timeout behavior
- Check that URLs with modified IDs show access denied
```

Add it to the rotation:

```javascript
planner: {
  styles: ['normal', 'psycho', 'curious', 'security'],
}
```

#### Control the Rotation

Use only stress-testing:

```javascript
planner: {
  styles: ['psycho'],
}
```

Alternate between normal and security:

```javascript
planner: {
  styles: ['normal', 'security', 'normal', 'security'],
}
```

A style name can appear more than once. The Planner cycles through the list by index.

### Writing Style Files

Style files are plain markdown with no frontmatter. The whole file becomes the `<approach>` section of the Planner's prompt.

Write it as instructions to a senior QA engineer on how to think about test scenarios. Include:

- **Mindset** — "Think like a hacker", "Think like a first-time user", "Focus on what previous tests missed".
- **Patterns to test** — empty fields, long strings, optional controls, CRUD order.
- **What counts as a test** — complete workflows, not just "open modal and check it exists".
- **What to skip** — navigation away from the page, duplicate coverage.

This "performer" style focuses on real user journeys:

```markdown
Think like a real user of this product. What would they actually do on this page?

Prefer maximal realistic happy paths:
- Fill required AND optional fields
- Set meaningful non-default choices
- Continue the story after creation (open the item, adjust attributes, add a note)
- One scenario per coherent feature chain

If a form has variable fields, fill at least 3 different values.
When the same action applies to multiple items, apply it to at least three.

Each scenario should read like a user story: "As a user, I want to accomplish X"
where X is a real business outcome, not a single control click.
```

## Page-Specific Rules

Use [rules](../reference/configuration.md#rules) to give the Planner extra instructions for specific pages:

```javascript
planner: {
  rules: [
    'no-delete-tests',                    // rules/planner/no-delete-tests.md — all pages
    { '/checkout/*': 'payment-rules' },   // rules/planner/payment-rules.md — checkout only
    { '/admin/*': 'admin-scenarios' },    // rules/planner/admin-scenarios.md — admin pages
  ],
}
```

Rules are additive. The Planner concatenates all matching rules and appends them to its prompt alongside the active style.

## Test Priorities

The Planner assigns priorities by business importance:

| Priority | Meaning | Examples |
|----------|---------|---------|
| **critical** | Core business functionality | Login, checkout, primary CRUD |
| **important** | Key user flows | Profile edit, search, main filters |
| **high** | Secondary features | Edge cases for critical flows |
| **normal** | Supporting actions | Settings, configuration |
| **low** | Minor interactions | Cosmetic checks, boundary tests |

## See Also

- [Configuration: Rules](../reference/configuration.md#rules) — URL-aware rule files
- [Agents](../reference/agents.md) — all agent descriptions
- [Commands](./commands.md) — CLI and TUI commands
