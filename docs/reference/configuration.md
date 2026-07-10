# Configuration

Explorbot reads its settings from `explorbot.config.js` or `explorbot.config.ts` in your project root.

## Quick start

```javascript
import { createGroq } from '@ai-sdk/groq';

const groq = createGroq({
  apiKey: process.env.GROQ_API_KEY,
});

export default {
  web: {
    url: 'http://localhost:3000',
  },
  ai: {
    model: groq('openai/gpt-oss-20b'),
  },
};
```

To set up a provider — OpenAI, Anthropic, Groq, Cerebras, Google, or Azure — see [AI providers](../basics/providers.md).

## Rules

Rules are markdown files that change how an agent behaves. They live in `rules/`, one folder per agent:

```
rules/
  researcher/         # Rules for the Researcher agent
    check-tooltips.md
  tester/             # Rules for the Tester agent
    wait-for-toasts.md
    admin-credentials.md
  planner/            # Rules + styles for the Planner agent
    no-delete-tests.md
    styles/
      normal.md
      psycho.md
      curious.md
```

Each rule file is plain markdown. Its content is appended to the agent's prompt.

### Configuring rules

Add a `rules` array to any agent's config. Each entry is either a filename (loads for all URLs) or an object mapping a URL pattern to a filename:

```javascript
ai: {
  agents: {
    tester: {
      rules: [
        'wait-for-toasts',                    // loads rules/tester/wait-for-toasts.md for all URLs
        { '/admin/*': 'admin-credentials' },  // loads rules/tester/admin-credentials.md only on /admin pages
      ],
    },
    researcher: {
      rules: [
        'check-tooltips',                     // loads rules/researcher/check-tooltips.md
        { '/users/*': 'user-testing' },       // loads rules/researcher/user-testing.md for /users and subpages
      ],
    },
    planner: {
      rules: [
        { '/checkout/*': 'payment-rules' },   // loads rules/planner/payment-rules.md for checkout pages
      ],
    },
  },
}
```

URL patterns work the same as [knowledge files](../workflow/knowledge.md#url-patterns): `*`, `/exact`, `/path/*`, `^regex$`, and glob patterns.

### Planning styles

The Planner and Chief agents cycle through styles — different testing approaches applied on each planning round. Built-in styles are `normal`, `psycho` (stress-testing), and `curious` (coverage gaps).

To change a style, extract the built-in ones and edit them:

```bash
npx explorbot extract-rules planner
```

This copies the planner's built-in rules, including the `styles/` folder, to `rules/planner/`. Edit them freely. Explorbot loads your `rules/` directory first and falls back to the built-in styles.

Set which styles to use, and their order, in config:

```javascript
ai: {
  agents: {
    planner: {
      styles: ['normal', 'psycho', 'curious'],  // default order
    },
  },
}
```

### Rules vs knowledge vs systemPrompt

| Mechanism | Purpose | URL-aware | File-based |
|-----------|---------|-----------|------------|
| **Rules** | Agent-specific instructions | Yes | Yes (`rules/<agent>/`) |
| **Knowledge** | App domain info (credentials, data) | Yes | Yes (`knowledge/`) |
| **systemPrompt** | Quick inline instructions | No | No (in config) |

Rules and `systemPrompt` work together: rules from files load first, then `systemPrompt` is appended.

## Tips

### Handle slow pages

```javascript
playwright: {
  timeout: 60000,
  waitForNavigation: 'networkidle',
}
```

### Use cheaper models for simple tasks

```javascript
ai: {
  model: groq('openai/gpt-oss-20b'),  // Default: fast and smart model
  agents: {
    // Fastest model for summarization
    'experience-compactor': { model: groq('llama-3.1-8b-instant') },
  },
}
```

### Run in Docker or CI

```javascript
playwright: {
  show: false,
  args: [
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
  ],
}
```

### Trace AI calls with Langfuse

```javascript
ai: {
  langfuse: {
    enabled: true,
    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
    secretKey: process.env.LANGFUSE_SECRET_KEY,
  },
}
```

See [Observability](../contributing/observability.md) for details.

## Agent configuration

Each agent takes its own model and system prompt.

### Available agents

| Agent | Purpose |
|-------|---------|
| `tester` | Executes test scenarios |
| `planner` | Generates test plans |
| `researcher` | Analyzes page structure |
| `navigator` | Handles browser navigation |
| `pilot` | Supervises test execution, detects stuck patterns |
| `driller` | Drills page components to learn interactions |
| `captain` | Orchestrates user commands |
| `experience-compactor` | Compresses experience data |
| `quartermaster` | Accessibility analysis |
| `historian` | Session recording, generates CodeceptJS or Playwright test files |
| `rerunner` | Heals failing steps when re-running generated tests |
| `analyst` | Writes the end-of-session markdown report |
| `fisherman` | Prepares test data through API requests |
| `chief` | API test planning |
| `curler` | API test execution |

### Agent options

```javascript
agents: {
  tester: {
    model: groq('openai/gpt-oss-20b'),    // Override default model
    enabled: true,                  // Enable/disable agent
    rules: ['wait-for-toasts'],    // Load rules from rules/tester/
    systemPrompt: '...',           // Append to system prompt (inline)
    beforeHook: { /* ... */ },     // Run before agent executes
    afterHook: { /* ... */ },      // Run after agent completes
  },
}
```

| Option | Type | Description |
|--------|------|-------------|
| `model` | `LanguageModel` | Model instance for this agent (overrides default) |
| `enabled` | `boolean` | Enable or disable the agent |
| `rules` | `Array<string \| Record<string, string>>` | Rule files to load from `rules/<agent>/` (URL-aware). See [Rules](#rules) |
| `systemPrompt` | `string` | Additional instructions appended to the agent's prompt (inline fallback) |
| `beforeHook` | `Hook \| HookPatternMap` | Code to run before agent execution |
| `afterHook` | `Hook \| HookPatternMap` | Code to run after agent execution |

Some agents take extra options: `pilot` accepts `stepsToReview` (recent steps reviewed per check, default 5); `planner` accepts `styles` (see [Planning styles](#planning-styles)); `rerunner` accepts `healLimit` (max heal attempts, default 3) and `recipes` (custom heal recipes, see [Rerunning Tests](../web-testing/rerun.md)). Researcher and Historian options are documented below.

See [Agent hooks](../web-testing/hooks.md) for hook configuration.

### Researcher agent options

The Researcher takes all standard agent options plus options that control interactive exploration:

| Option | Type | Description |
|--------|------|-------------|
| `maxExpandableClicks` | `number` | Maximum expandable elements clicked during deep analysis (default: 10) |
| `errorPageTimeout` | `number` | Seconds to wait for a loading page to settle before error-page detection (default: 10, `0` disables the wait) |
| `focusSections` | `string[]` | CSS selectors that narrow research to a matching element when present (e.g. an open modal or drawer). First match wins. Applies only to the per-section fallback used after a truncated research response. |

```javascript
ai: {
  agents: {
    researcher: {
      maxExpandableClicks: 15,
      focusSections: ['[role="dialog"]'],
    },
  },
}
```

See [Researcher agent](../web-testing/researcher.md) for full documentation and examples.

### Historian agent options

| Option | Type | Description |
|--------|------|-------------|
| `framework` | `'codeceptjs' \| 'playwright'` | Output format for generated test files. Default: `'codeceptjs'`. |

```javascript
ai: {
  agents: {
    historian: {
      framework: 'playwright',
    },
  },
}
```

With `'playwright'`, runs are saved as `@playwright/test` `.spec.ts` files using the actual Playwright calls captured at runtime. See [Automated tests](../web-testing/automated-tests.md).

See [AI providers](../basics/providers.md) for recommended models and provider setup.

## Playwright settings

### Browser selection

```javascript
playwright: {
  browser: 'chromium',  // Most compatible
  // browser: 'firefox',  // Better privacy testing
  // browser: 'webkit',   // Safari/iOS testing
}
```

### Viewport and window size

```javascript
playwright: {
  windowSize: '1920x1080',
  viewport: {
    width: 1920,
    height: 1080,
  },
}
```

### Browser context options

```javascript
playwright: {
  ignoreHTTPSErrors: true,
  bypassCSP: true,
  userAgent: 'Mozilla/5.0 (Explorbot)',
  locale: 'en-GB',
  colorScheme: 'dark',
  basicAuth: { username: 'user', password: 'pass' },
  emulate: { ...devices['iPhone 13'] },
}
```

The browser session (cookies, localStorage) is restored when you launch with `--session` — see [commands.md](./commands.md#--session).

### Loading Indicators

For SPAs, `domcontentloaded` can happen before the application finishes loading page data. Use `spinnerSelectors` to tell Explorbot which loading indicators should be treated as part of page readiness:

```javascript
playwright: {
  waitForTimeout: 5000,
  spinnerSelectors: ['.spinner', '.loading', '[aria-busy="true"]'],
}
```

Explorbot waits for `domcontentloaded`, then races Playwright `networkidle`, visible configured spinners becoming hidden, or timeout before capturing the page state. If no configured spinner is visible on a page, the spinner rule is ignored for that page.

## Directory Structure

The default layout:

```
your-project/
├── explorbot.config.js
├── knowledge/           # Domain hints (you create these)
│   └── login.md
├── rules/               # Agent-specific rules (you create these)
│   ├── tester/
│   │   └── wait-for-toasts.md
│   └── planner/
│       └── styles/      # Custom planning styles
├── experience/          # Learned patterns (auto-generated)
│   └── abc123.md
└── output/              # Test results (auto-generated)
    ├── states/
    ├── research/
    ├── plans/
    ├── tests/
    ├── reports/
    └── docs/
```

Change the paths:

```javascript
dirs: {
  knowledge: './test/knowledge',
  experience: './test/experience',
  output: './test/output',
}
```

## Environment variables

Keep secrets in environment variables:

```bash
# .env
GROQ_API_KEY=gsk_...
LANGFUSE_PUBLIC_KEY=pk-...
LANGFUSE_SECRET_KEY=sk-...
```

Reference them in config:

```javascript
const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });

export default {
  ai: {
    model: groq('openai/gpt-oss-20b'),
    langfuse: {
      enabled: true,
      publicKey: process.env.LANGFUSE_PUBLIC_KEY,
      secretKey: process.env.LANGFUSE_SECRET_KEY,
    },
  },
};
```

## Config file locations

Explorbot looks for a config file in this order:

1. `explorbot.config.js`
2. `explorbot.config.mjs`
3. `explorbot.config.ts`
4. `config/explorbot.config.js`
5. `config/explorbot.config.mjs`
6. `config/explorbot.config.ts`
7. `src/config/explorbot.config.js`
8. `src/config/explorbot.config.mjs`
9. `src/config/explorbot.config.ts`

Or pass a custom path:

```bash
npx explorbot explore /dashboard --config ./custom/path/config.js
```

## Full configuration reference

```javascript
export default {
  // Application URL (required — or set playwright.url instead)
  web: {
    url: 'http://localhost:3000',
  },

  // API testing (optional)
  api: {
    baseEndpoint: 'http://localhost:3000/api/v1',
    spec: ['http://localhost:3000/api/openapi.json'],
    headers: { 'Content-Type': 'application/json' },
    // bootstrap: async ({ headers, baseEndpoint }) => { ... },
    // teardown: async ({ headers, baseEndpoint }) => { ... },
  },

  // Browser automation settings (url is inherited from web.url if not set)
  playwright: {
    browser: 'chromium',           // 'chromium' | 'firefox' | 'webkit'
    show: false,                   // Show browser window
    windowSize: '1280x720',        // Browser window size
    slowMo: 0,                     // Slow down actions (ms)
    timeout: 30000,                // Default timeout (ms)
    waitForNavigation: 'load',     // 'load' | 'domcontentloaded' | 'networkidle'
    waitForTimeout: 1000,          // Wait after navigation (ms)
    spinnerSelectors: [],          // Loading indicators to wait for before page capture
    ignoreHTTPSErrors: false,      // Ignore HTTPS certificate errors
    userAgent: 'custom-agent',     // Custom user agent string
    viewport: {
      width: 1280,
      height: 720,
    },
    args: ['--disable-gpu'],       // Browser launch arguments
    chromium: { args: [] },        // Chromium-specific args
    firefox: { args: [] },         // Firefox-specific args
    webkit: { args: [] },          // WebKit-specific args
  },

  // AI provider settings
  ai: {
    model: groq('openai/gpt-oss-20b'),   // Default model instance (required)
    visionModel: groq('meta-llama/llama-4-scout-17b-16e-instruct'),  // Model for screenshot analysis; setting it enables vision features
    config: {},                    // Additional provider config
    langfuse: {                    // Observability settings
      enabled: true,
      publicKey: 'pk-...',
      secretKey: 'sk-...',
      baseUrl: 'https://cloud.langfuse.com',
    },
    agents: {                      // Per-agent configuration
      tester: {
        model: groq('openai/gpt-oss-20b'),
        enabled: true,
        rules: ['wait-for-toasts', { '/admin/*': 'admin-creds' }],
        systemPrompt: '...',       // Inline fallback
      },
      planner: {
        styles: ['normal', 'psycho', 'curious'],
        rules: [{ '/checkout/*': 'payment-rules' }],
      },
      researcher: {                // Researcher-specific options
        model: groq('openai/gpt-oss-20b'), // Override default model
        enabled: true,             // Enable/disable agent
        systemPrompt: '...',       // Additional instructions
        maxExpandableClicks: 10,   // Max expandable elements clicked in deep analysis
        errorPageTimeout: 10,      // Seconds to wait for page to settle (0 disables)
        focusSections: [],         // CSS selectors that narrow per-section research
      },
      pilot: { stepsToReview: 5 }, // Recent steps the Pilot reviews
      navigator: { /* ... */ },
      captain: { /* ... */ },
      driller: { /* ... */ },
      'experience-compactor': { /* ... */ },
      quartermaster: { /* ... */ },
      historian: { /* ... */ },
      fisherman: { /* ... */ },
      rerunner: { /* ... */ },
      analyst: { /* ... */ },
    },
  },

  // HTML processing settings
  html: {
    minimal: {
      include: ['form', 'button', 'input'],
      exclude: ['script', 'style'],
    },
    combined: {
      include: ['*'],
      exclude: ['script', 'style', 'svg'],
    },
    text: {
      include: ['p', 'h1', 'h2', 'h3', 'span'],
      exclude: ['nav', 'footer'],
    },
  },

  // Action execution settings
  action: {
    delay: 1000,                   // Delay between actions (ms)
    retries: 3,                    // Retry failed actions
  },

  // Regex to detect dynamic URL segments (IDs, slugs) for plan deduplication
  // Built-in patterns (numeric, UUID, ULID, hex) are always active
  // dynamicPageRegex: 'your-custom-pattern',

  // Directory paths
  dirs: {
    knowledge: 'knowledge',        // Domain knowledge files
    experience: 'experience',      // Learned patterns
    output: 'output',              // Test results and logs
  },
};
```

## See also

- [API testing](../api-testing/basics.md) — API testing setup and commands
- [AI providers](../basics/providers.md) — provider setup examples
- [Agents](../web-testing/agents.md) — agent descriptions and workflows
- [Agent hooks](../web-testing/hooks.md) — custom code before and after an agent runs
- [Researcher agent](../web-testing/researcher.md) — Researcher configuration and usage
- [Planner agent](../web-testing/planner.md) — planning styles and customization
- [Knowledge files](../workflow/knowledge.md) — domain knowledge format
- [Observability](../contributing/observability.md) — Langfuse integration
