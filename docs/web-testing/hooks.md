# Agent Hooks

Hooks run custom code before or after a specific agent. Use them to prepare and clean up the page per agent.

> [!NOTE]
> For simple page automation such as waiting or clicking cookie banners, use [Knowledge Files](../workflow/knowledge.md) with the `wait`, `waitForElement`, or `code` fields. Reach for hooks when you need different behavior for different agents.

## When to Use Hooks vs Knowledge

| Use Case | Solution |
|----------|----------|
| Wait for element on all page visits | Knowledge: `waitForElement` |
| Dismiss cookie banner on page load | Knowledge: `code` |
| Wait for network idle only during research | Hook: `researcher.beforeHook` |
| Clean up test data after each test | Hook: `tester.afterHook` |
| Different waits for navigation vs testing | Hooks for each agent |

## Configuration

Hooks are configured per-agent in `explorbot.config.js`:

```javascript
export default {
  ai: {
    model: myProvider('gpt-4o'),
    agents: {
      navigator: {
        beforeHook: {
          type: 'playwright',
          hook: async ({ page, url }) => {
            await page.waitForLoadState('networkidle');
          }
        }
      },
      tester: {
        afterHook: {
          type: 'codeceptjs',
          hook: async ({ I, url }) => {
            await I.executeScript(() => localStorage.clear());
          }
        }
      }
    }
  }
}
```

## Hook Types

### Playwright Hooks

Get direct access to the Playwright page object:

```javascript
beforeHook: {
  type: 'playwright',
  hook: async ({ page, url }) => {
    await page.waitForLoadState('networkidle');
    await page.locator('.loading').waitFor({ state: 'hidden' });
  }
}
```

### CodeceptJS Hooks

Use the CodeceptJS `I` actor:

```javascript
beforeHook: {
  type: 'codeceptjs',
  hook: async ({ I, url }) => {
    await I.waitForElement('.page-ready');
    await I.wait(1);
  }
}
```

## URL Pattern Matching

Run different hooks for different URL patterns:

```javascript
researcher: {
  beforeHook: {
    '/login': {
      type: 'codeceptjs',
      hook: async ({ I }) => await I.waitForElement('#login-form')
    },
    '/admin/*': {
      type: 'playwright',
      hook: async ({ page }) => await page.waitForLoadState('networkidle')
    },
    '/api/*': {
      type: 'codeceptjs',
      hook: async ({ I }) => await I.wait(2)
    }
  }
}
```

### Pattern Syntax

| Pattern | Matches |
|---------|---------|
| `/login` | Exact path `/login` |
| `/admin/*` | `/admin` and any path starting with `/admin/` |
| `*` | All URLs (fallback) |
| `^/users/\d+$` | Regex: `/users/` followed by digits |
| `**/*.html` | Glob: any `.html` file |

## Supported Agents

| Agent | beforeHook | afterHook | Description |
|-------|------------|-----------|-------------|
| `navigator` | After navigation | After page capture | Browser navigation |
| `researcher` | After navigation | After research complete | Page analysis |
| `tester` | Before test loop | After test loop | Test execution |
| `driller` | Before drilling starts | After drilling completes | Component drilling |
| `captain` | Before handling command | After command complete | User commands |

> [!WARNING]
> The `planner` agent does not support hooks as it doesn't interact with the browser.

## Examples

### Wait for SPA to Load

```javascript
navigator: {
  beforeHook: {
    type: 'playwright',
    hook: async ({ page }) => {
      await page.waitForFunction(() => {
        return window.__APP_READY__ === true;
      });
    }
  }
}
```

### Dismiss Modals Before Research

```javascript
researcher: {
  beforeHook: {
    type: 'codeceptjs',
    hook: async ({ I }) => {
      const modalVisible = await I.grabNumberOfVisibleElements('.modal-overlay');
      if (modalVisible > 0) {
        await I.click('.modal-close');
        await I.wait(0.5);
      }
    }
  }
}
```

### Clean Up After Tests

```javascript
tester: {
  afterHook: {
    type: 'playwright',
    hook: async ({ page }) => {
      await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });
    }
  }
}
```

### Different Behavior per URL

```javascript
tester: {
  beforeHook: {
    '/checkout': {
      type: 'codeceptjs',
      hook: async ({ I }) => {
        // Ensure cart has items before checkout tests
        await I.executeScript(() => {
          if (!localStorage.getItem('cart')) {
            localStorage.setItem('cart', JSON.stringify([{ id: 1, qty: 1 }]));
          }
        });
      }
    },
    '/admin/*': {
      type: 'codeceptjs',
      hook: async ({ I }) => {
        // Ensure admin session
        await I.waitForElement('.admin-header', 5);
      }
    }
  }
}
```

## Error Handling

A hook error is logged but does not stop the agent:

```javascript
beforeHook: {
  type: 'codeceptjs',
  hook: async ({ I }) => {
    try {
      await I.waitForElement('.optional-banner', 2);
      await I.click('.dismiss');
    } catch {
      // Banner not present, continue
    }
  }
}
```

## Execution Flow

```
┌─────────────────────────────────────────────────────────┐
│                    Agent Execution                       │
├─────────────────────────────────────────────────────────┤
│  1. Agent starts                                         │
│  2. Navigate to URL (if applicable)                      │
│  3. ▶ beforeHook executes                               │
│  4. Agent performs main work                             │
│  5. ▶ afterHook executes                                │
│  6. Agent completes                                      │
└─────────────────────────────────────────────────────────┘
```

## See Also

- [Knowledge Files](../workflow/knowledge.md) — page-level automation with `wait`, `waitForElement`, `code`
- [Configuration](../reference/configuration.md) — full configuration reference
- [Agents](./agents.md) — agent descriptions and workflows
