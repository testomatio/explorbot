# Planner Agent

The Planner agent turns Researcher findings into test scenarios. Each scenario has steps, expected outcomes, and a priority, ready for the Tester to run.

## Overview

When you run `/plan` or `/explore`, the Planner:

1. Receives the Researcher's UI map of the current page.
2. Applies a planning style.
3. Generates 3 to 12 scenarios with steps and expected outcomes.
4. Assigns priorities based on business importance.

Run it again and the Planner adds new scenarios in a different style. It skips scenarios that already exist.

## Write a useful focus

Focus works best when it names one feature boundary, the user goal, and the behavior that matters. Treat it as a testing brief, not a keyword.

```bash
npx explorbot plan /checkout --focus "Guest checkout: complete an order with card payment; cover validation, declined payment, retry, and confirmation without testing account registration"
```

The same focus works in the TUI:

```
/plan --focus "Guest checkout: complete an order with card payment; cover validation, declined payment, retry, and confirmation without testing account registration"
```

`checkout` alone leaves the scope ambiguous. The fuller focus tells Planner where the flow starts and ends, which outcomes deserve scenarios, and what to leave out. Keep the focus observable from the current page; put durable product facts or credentials in [Knowledge](../workflow/knowledge.md), not in the focus.

## Configuration

```javascript
ai: {
  agents: {
    planner: {
      model: groq('gpt-oss-20b'),
      styles: ['normal', 'curious', 'psycho'],
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
| `styles` | `string[]` | `['normal', 'curious', 'psycho']` | Style names and cycling order |
| `rules` | `RuleEntry[]` | `[]` | URL-aware rule files from `rules/planner/` |
| `systemPrompt` | `string` | - | Inline instructions appended to the prompt |

## Planning Styles

A style is a testing approach that shapes which tests the Planner creates. Styles cycle on each planning iteration, so repeated runs produce different kinds of tests. See [Planning Styles](../workflow/planning-styles.md) for how cycling works, custom style files, and `extract-rules`.

### Built-in Styles

All three built-in styles rank scenarios by outcome strength, from strongest to weakest:

1. **Data change** — a record is created, edited, deleted; a setting is persisted; a message is sent; a job is triggered.
2. **State change** — a route change, a filter or sort applied to real data, a mode or auth change the app remembers.
3. **UI-only change** — something opens, closes, is cancelled, is hovered, or is toggled for display. The application registers nothing new.

The Planner prefers scenarios that end in category 1 or 2. It proposes category 3 only when the UI-only behaviour has a verifiable side effect, such as a warning prompt, a persisted draft, or a badge appearing.

| Style | Focus | What it generates |
|-------|-------|-------------------|
| **normal** | Complete user workflows | CRUD operations, full commit flows, filter+verify flows, distributed across feature areas. UI-only tests (tab switching, pagination, view toggles) come last. |
| **curious** | Coverage gaps | Cross-references previous test results with page research to find untested controls. Variation scenarios and dismissal scenarios are kept separate — the planner will not merge them by appending a cancel at the end. |
| **psycho** | Invalid and extreme inputs | Attacks **every reachable control in the same scenario** with a different strange value — empty, 10000 chars, unicode, SQL, script tags, invalid formats, conflicting toggles, out-of-range dates — then commits. Scenarios that enter bad data and cancel are rejected: the application never received the payload. |

### Style Cycling

The default cycle is: normal, curious, psycho, then back to normal. The 1st `/plan` uses normal, the 2nd curious, the 3rd psycho. Each iteration proposes only scenarios that aren't already in the plan. When all feature areas are covered, the Planner returns an empty list.

Force a specific style:

```
/plan --style psycho
```

Set `styles` in the config to control the rotation. To customize or add style files, see [Planning Styles](../workflow/planning-styles.md).

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

- [Planning Styles](../workflow/planning-styles.md) — cycling, custom styles, `extract-rules`
- [Configuration: Rules](../reference/configuration.md#rules) — URL-aware rule files
- [Agents](./agents.md) — all agent descriptions
- [Commands](../reference/commands.md) — CLI and TUI commands
