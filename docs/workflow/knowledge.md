# Knowledge System

Knowledge files tell explorbot facts about your app. Agents read them to make better decisions about authentication, special workflows, and app-specific behavior.

## Adding Knowledge

### Interactive Mode

```bash
npx explorbot learn
```

Opens a TUI form where you can:
- Enter a URL pattern
- See existing knowledge for that URL
- Add new knowledge

### CLI Mode

```bash
npx explorbot learn "<url-pattern>" "<description>"
```

Examples:

```bash
# Login credentials
npx explorbot learn "/login" "Use credentials: admin@example.com / secret123"

# General knowledge (applies to all pages)
npx explorbot learn "*" "This is a React SPA. Wait for loading spinners to disappear."

# Specific page behavior
npx explorbot learn "/checkout" "Credit card field requires format: XXXX-XXXX-XXXX-XXXX"
```

### Inside TUI

While exploring, use the `/learn` command.

```
/learn                              # Opens interactive form
/learn Test user: test@example.com  # Adds to current page
```

### API Testing

[API testing](../api-testing/overview.md) shares the same `knowledge/` directory. `npx explorbot api know <endpoint> "<description>"` adds endpoint-scoped notes, stored with an `endpoint:` frontmatter field instead of `url:`.

## URL Patterns

| Pattern | Matches |
|---------|---------|
| `/login` | Exact path `/login` |
| `/admin/*` | Any path starting with `/admin/` |
| `*` | All pages (general knowledge) |
| `^/users/\d+` | Regex: `/users/` followed by digits |
| `~dashboard~` | Regex: "dashboard" anywhere in URL (tilde on both sides) |

## Knowledge File Format

Knowledge lives in `./knowledge/` as markdown files with frontmatter:

```markdown
---
url: /login
title: Login Page
---

Test credentials:
- email: admin@example.com
- password: secret123

Notes:
- Submit button disabled until email validates
- 3 failed attempts triggers captcha
- "Remember me" checkbox persists session for 30 days
```

### Frontmatter Fields

| Field | Purpose |
|-------|---------|
| `url` | URL pattern to match (optional, defaults to `*`) |
| `title` | Human-readable title (optional) |
| Custom fields | Any additional metadata for agents |

## Variables

Knowledge files support variable interpolation with `${namespace.key}` syntax. Explorbot resolves variables when it loads the knowledge.

### Environment Variables

Use `${env.VARNAME}` to reference environment variables. This keeps secrets out of knowledge files.

```markdown
---
url: /login
---

Login credentials:
- email: ${env.LOGIN}
- password: ${env.PASSWORD}
```

Missing environment variables become an empty string.

### Config Variables

Use `${config.path}` to reference values from `explorbot.config.js` with dot notation.

```markdown
---
url: *
---

Base URL: ${config.playwright.url}
Browser: ${config.playwright.browser}
```

You can reference any scalar config value. Object values become an empty string.

### Supported Namespaces

| Namespace | Source | Example |
|-----------|--------|---------|
| `env` | `process.env` | `${env.API_KEY}` |
| `config` | `explorbot.config.js` | `${config.playwright.url}` |

Expressions with an unknown namespace (such as `${other.value}`) or no namespace (such as `${value}`) are left as-is.

## Page Automation

Knowledge files can run automation commands when explorbot navigates to a matching page. Use this for loading states, cookie banners, or page-specific setup.

### Available Fields

| Field | Type | Description |
|-------|------|-------------|
| `wait` | `number` | Wait for specified seconds after page load |
| `waitForElement` | `string` | Wait for element to appear (CSS selector) |
| `code` | `string` | Execute CodeceptJS code after navigation |
| `statePush` | `boolean` | Use `history.pushState` instead of full navigation |

### Wait for Page Load

```markdown
---
url: /dashboard
wait: 2
waitForElement: '.dashboard-loaded'
---

Dashboard requires data to load before interaction.
```

### Execute Custom Code

```markdown
---
url: /app/*
code: |
  I.waitForElement('.app-ready');
  I.click('.cookie-accept');
  I.wait(1);
---

App pages need cookie consent dismissed and loading complete.
```

### CodeceptJS Effects

Knowledge code can use CodeceptJS effects for error handling and retries:

| Effect | Purpose |
|--------|---------|
| `tryTo(fn)` | Execute without failing - returns `true`/`false` |
| `retryTo(fn, maxTries, interval)` | Retry on failure with polling |
| `within(context, fn)` | Execute within a specific element context |

**Example with effects:**

```markdown
---
url: /dashboard
code: |
  await tryTo(() => I.click('.cookie-dismiss'));
  await retryTo(() => {
    I.click('Reload Data');
    I.waitForElement('.data-loaded');
  }, 5, 500);
---

Dashboard may show cookie banner. Data loads asynchronously - retry reload if needed.
```

> [!NOTE]
> Effects are async. Use `await` when you call them in knowledge code.

### SPA Navigation

For single-page apps where a full reload breaks state:

```markdown
---
url: /settings/*
statePush: true
---

Settings uses client-side routing. Use pushState to preserve app state.
```

> [!TIP]
> Use knowledge automation for page-specific behavior. For agent-specific logic, such as code that runs only during testing, use [Agent Hooks](../web-testing/hooks.md) instead.

### Execution Order

When explorbot navigates to a page, automation runs in this order:

1. Navigation (`I.amOnPage()` or `history.pushState`)
2. `wait` (if specified)
3. `waitForElement` (if specified)
4. `code` (if specified)

## What to Document

### Authentication

```markdown
---
url: /login
---

Credentials: test@example.com / testpass123
OAuth: Use "Continue with Google" for SSO testing
2FA: Code is always 123456 in test environment
```

### Form Behavior

```markdown
---
url: /checkout
---

Required fields: name, email, card number, expiry, CVV
Card format: XXXX-XXXX-XXXX-XXXX
Test card: 4111-1111-1111-1111, any future expiry, any CVV
Promo code "TEST10" gives 10% discount
```

### Navigation Quirks

```markdown
---
url: *
---

- App uses React Router, wait for route transitions
- Loading spinner class: .spinner-overlay
- Modals block interaction until dismissed
- Session expires after 15 minutes of inactivity
```

### Test Data

```markdown
---
url: /users
---

Test users available:
- admin@test.com (admin role)
- user@test.com (standard user)
- readonly@test.com (view-only permissions)
```

## How Agents Use Knowledge

When an agent works on a page, it gets the knowledge whose URL pattern matches:

1. **Navigator** — uses credentials and knows about special interactions
2. **Researcher** — reads page structure and hidden elements
3. **Planner** — adds edge cases and validation rules to test scenarios
4. **Tester** — uses test data and expected behaviors

## Best Practices

1. **Start with auth** — add login credentials before exploring protected areas
2. **Use `*` for globals** — document app-wide behavior such as loading states and timeouts
3. **Be specific** — give exact selectors, formats, and values when you know them
4. **Update as you learn** — add knowledge when agents struggle with an interaction

## File Organization

```
./knowledge/
├── login.md           # /login page
├── checkout.md        # /checkout page
├── general.md         # * (all pages)
└── admin_users.md     # /admin/users/*
```

Files are named after the URL pattern. Multiple entries for the same URL append to the same file.

## See Also

- [Agent Hooks](../web-testing/hooks.md) — per-agent custom code execution
- [Configuration](../reference/configuration.md) — full configuration reference
- [Page Interaction](../web-testing/page-interaction.md) — how agents interact with pages
