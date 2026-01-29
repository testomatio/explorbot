# Knowledge System

Explorbot can learn about your application through knowledge files. This helps agents make better decisions — especially for authentication, special workflows, or app-specific behavior.

## Adding Knowledge

### Interactive Mode

```bash
explorbot know
```

Opens a TUI form where you can:
- Enter a URL pattern
- See existing knowledge for that URL
- Add new knowledge

### CLI Mode

```bash
explorbot know "<url-pattern>" "<description>"
```

Examples:

```bash
# Login credentials
explorbot know "/login" "Use credentials: admin@example.com / secret123"

# General knowledge (applies to all pages)
explorbot know "*" "This is a React SPA. Wait for loading spinners to disappear."

# Specific page behavior
explorbot know "/checkout" "Credit card field requires format: XXXX-XXXX-XXXX-XXXX"
```

### Inside TUI

While exploring, use the `/know` command:

```
/know                              # Opens interactive form
/know Test user: test@example.com  # Adds to current page
```

## URL Patterns

| Pattern | Matches |
|---------|---------|
| `/login` | Exact path `/login` |
| `/admin/*` | Any path starting with `/admin/` |
| `*` | All pages (general knowledge) |
| `^/users/\d+` | Regex: `/users/` followed by digits |
| `~dashboard` | Contains "dashboard" anywhere in URL |

## Knowledge File Format

Knowledge is stored in `./knowledge/` as markdown files with frontmatter:

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
| `url` | URL pattern to match (required) |
| `title` | Human-readable title (optional) |
| Custom fields | Any additional metadata for agents |

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

When an agent operates on a page, it receives relevant knowledge based on URL matching:

1. **Navigator** — Uses credentials, knows about special interactions
2. **Researcher** — Understands page structure, hidden elements
3. **Planner** — Incorporates edge cases, validation rules into test scenarios
4. **Tester** — Uses test data, knows expected behaviors

## Best Practices

1. **Start with auth** — Add login credentials before exploring protected areas
2. **Use `*` for globals** — Document app-wide behaviors (loading states, timeouts)
3. **Be specific** — Include exact selectors, formats, and values when known
4. **Update as you learn** — Add knowledge when agents struggle with interactions

## File Organization

```
./knowledge/
├── login.md           # /login page
├── checkout.md        # /checkout page
├── general.md         # * (all pages)
└── admin_users.md     # /admin/users/*
```

Files are named based on URL pattern. Multiple entries for the same URL are appended to the same file.
