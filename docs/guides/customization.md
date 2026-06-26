# Customization

Most real apps need a little setup before Explorbot can test them: a login, a cookie banner to dismiss, a slow page to wait for. This page shows the shortest recipe for each common case.

You have two tools:

- **Knowledge files** — markdown hints and small automations that run per URL. Start here.
- **Hooks** — code that runs for one agent only. Use these when knowledge isn't enough.

Each recipe below links to the full reference.

## Log in

Add a knowledge file for your login page and give Explorbot the credentials. Keep secrets in environment variables and reference them with `${env.NAME}`.

`knowledge/login.md`:

```markdown
---
url: /login
---

Log in with these credentials:
- email: ${env.APP_EMAIL}
- password: ${env.APP_PASSWORD}
```

Explorbot reads this when it opens the login page and signs in on its own. See [Knowledge](./knowledge.md).

## Stay logged in between runs

Logging in on every run is slow. Use `--session` to save cookies and local storage, then restore them next time:

```bash
npx explorbot start /login --session        # logs in, saves the session
npx explorbot start /dashboard --session    # restores it, skips login
```

Pass a filename to keep more than one session: `--session auth.json`.

## Dismiss a cookie banner

A cookie bar blocks the page until you accept it. Dismiss one on every page with a knowledge file on `*`. Wrap the click in `tryTo` so it does nothing when the bar is absent:

`knowledge/cookies.md`:

```markdown
---
url: *
code: |
  await tryTo(() => I.click('Accept all'));
---

A cookie banner appears on first load. Accept it before interacting.
```

## Close modals and popups

A modal can cover the page right after it loads. Close it with a `code` block that runs only if the modal is there:

```markdown
---
url: /checkout
code: |
  await tryTo(() => I.click('[aria-label="Close"]'));
---
```

To close a popup for one agent only — say, before research but not during a test — use a [hook](./hooks.md) instead.

## Wait for slow or single-page apps

Some pages show a spinner before the real content loads. Tell Explorbot to wait:

```markdown
---
url: /dashboard
wait: 2
waitForElement: '.dashboard-ready'
---
```

`wait` pauses for the given seconds. `waitForElement` waits for a selector to appear. For single-page apps where a full reload breaks state, add `statePush: true` so Explorbot navigates without reloading.

## Set up and restore test data

To seed data before tests and clean it up after, use agent hooks. `tester.beforeHook` runs before the test loop; `afterHook` runs after it:

```javascript
ai: {
  agents: {
    tester: {
      beforeHook: {
        type: 'codeceptjs',
        hook: async ({ I }) => {
          await I.executeScript(() => localStorage.setItem('cart', '[]'));
        },
      },
      afterHook: {
        type: 'playwright',
        hook: async ({ page }) => {
          await page.evaluate(() => localStorage.clear());
        },
      },
    },
  },
}
```

See [Hooks](./hooks.md) for every agent and hook type.

## Avoid fragile locators

Some frameworks generate random IDs that change on every load — for example Ember's `#ember123`. Tell Explorbot to ignore them, and it will prefer stable locators like ARIA labels and visible text:

```markdown
---
url: /projects/*
---

## Framework

This app is built with Ember. Do not use auto-generated IDs like #ember123 in locators.
Prefer ARIA labels and visible text.
```

## Knowledge or hooks?

Reach for a knowledge file first. It is markdown, lives beside your other knowledge, and applies to every agent on matching pages. Use a hook when you need code to run for one agent only, or different behavior for navigation versus testing.

| Problem | Use |
|---------|-----|
| Wait or dismiss something on every visit | Knowledge: `wait`, `waitForElement`, `code` |
| Provide credentials or test data as text | Knowledge body |
| Run code for one agent only | Hook |
| Seed or clean data around tests | Hook: `tester.beforeHook` / `afterHook` |

Learn more in [Knowledge](./knowledge.md) and [Hooks](./hooks.md).
