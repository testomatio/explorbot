# Automated Tests

When Explorbot runs a plan, it saves the executed scenarios to a runnable test file under `output/tests/`. Commit it, run it from CI, or edit it by hand.

Pick the framework you use:

- **Playwright** — set `ai.agents.historian.framework: 'playwright'` in your config. Output is a `.spec.ts` file.
- **CodeceptJS** — the default. Output is a `.js` file.

If you use neither, start with Playwright.

## Playwright

A file Explorbot produced from a plan called *Creating a plan*, trimmed for readability. See `example/output/tests/` for full examples.

```ts
import { test, expect } from '@playwright/test';

test.describe('Creating a plan', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/projects/zyntra/plans/');
    await page.waitForTimeout(1000);
  });

  test('Create a new manual plan and verify it appears in the list', async ({ page }) => {
    await test.step("Click the 'New plan' button in toolbar", async () => {
      await page.getByRole('button', { name: 'New plan' }).first().click();
    });

    await test.step('Select Manual plan type in modal', async () => {
      await page.locator('#portal-container').getByRole('button', { name: 'Manual' }).click();
    });

    await test.step('Click Save', async () => {
      await page.getByRole('button', { name: 'Save' }).click();
    });

    await test.step('Verification', async () => {
      await expect(page).toContainText('Test Plan UI Creation 001');
    });
  });

  // FAILED: Create a new automated plan and verify it appears under automated tab
  test.skip('Create a new automated plan and verify it appears under automated tab', async ({ page }) => {
    // ...
  });

  test.fixme('Delete a plan from the list', async ({ page }) => {
    // open the action menu
    // click Delete
    // confirm in dialog
  });
});
```

Three things to notice:

1. Every action is its own `test.step`. The label is the AI's description of that action, so the Playwright report tree reads like the plan it came from. Failures land on a single step.
2. The locators are real. `page.getByRole('button', { name: 'New plan' })` is what Playwright ran during the session, not a translation. If it worked then, it works now.
3. `test.beforeEach` reaches the starting state. It navigates to the plan's start URL and replays the `wait` / `waitForElement` knowledge you declared for that page. The closing `test.step('Verification', ...)` block holds whatever the Pilot verified.

Run it the normal way:

```bash
npx playwright test output/tests/runs_archive_feature_testing.spec.ts
```

`npx explorbot rerun` does not run Playwright specs. It points you at `npx playwright test` instead.

### Scenarios that didn't pass

The file always runs, even when some scenarios failed:

- Passed scenarios become plain `test(...)`.
- Failed scenarios become `test.skip(...)` with a `// FAILED: <scenario>` comment above them, so you can see what broke and decide whether to fix or drop it.
- Scenarios Explorbot didn't reach become `test.fixme(...)`, with the planned steps preserved as comments.

Commit the file as-is. Passing scenarios run, broken ones are skipped and visible, planned ones wait for you.

## CodeceptJS

The default output is a `Feature` with one `Scenario` per plan entry, plus a `Before` block for setup:

```js
import step, { Section } from 'codeceptjs/steps';

Feature('Runs Archive Feature Testing')

Before(({ I }) => {
  I.amOnPage('/projects/zyntra/runs/archive');
  I.wait(1);
});

Scenario('Apply filters specific to archived runs and verify results', ({ I }) => {
  Section('Open the filter panel');
  I.click({ css: 'button.btn-only-icon.btn-lg:has(svg.md-icon-filter)' });

  Section('Pick the Passed status');
  I.click('Select status');
  I.click('Passed');
  I.click('Apply');

  I.see('1 run found');
});
```

Two things to notice:

1. `Before` reaches the starting state. It calls `I.amOnPage` for the plan's start URL and replays the `wait` / `waitForElement` knowledge you declared for that page.
2. Steps are grouped by `Section('...')`. Each label is the AI's description of that group, so the test reads top to bottom like the plan it came from.

Run it with:

```bash
npx explorbot rerun output/tests/runs_archive_feature_testing.js
```

`npx explorbot rerun` heals broken steps automatically. See [Rerun](./rerun.md).

### Scenarios that didn't pass

The file always runs, even when some scenarios failed:

- Passed scenarios become plain `Scenario(...)`.
- Failed scenarios become `Scenario.skip(...)` with a `// FAILED: <scenario>` comment above them.
- Scenarios Explorbot didn't reach become `Scenario.todo(...)`, with the planned steps preserved as comments.

Commit the file as-is. Passing scenarios run, broken ones are skipped and visible, planned ones wait for you.

## See also

- [Test Plans](../workflow/test-plans.md) — the markdown plans that drive these test files
- [Rerun](./rerun.md) — re-run CodeceptJS tests with auto-healing
- [Configuration → Historian Agent Options](../reference/configuration.md#historian-agent-options) — the `framework` option
