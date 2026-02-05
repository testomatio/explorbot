# Configuration

Explorbot uses a configuration file to customize its behavior. Create `explorbot.config.js` or `explorbot.config.ts` in your project root.

## Quick Start

```javascript
import { createGroq } from '@ai-sdk/groq';

const groq = createGroq({
  apiKey: process.env.GROQ_API_KEY,
});

export default {
  playwright: {
    browser: 'chromium',
    url: 'http://localhost:3000',
  },
  ai: {
    provider: groq,
    model: 'gpt-oss-20b',
  },
};
```

For detailed AI provider setup (OpenAI, Anthropic, Groq, Cerebras, Google, Azure), see [AI Providers](./providers.md).

## Tips & Tricks

### Add custom instructions to agents

Teach agents about your app's patterns without changing source code:

```javascript
ai: {
  agents: {
    tester: {
      systemPrompt: `
        Wait for toast notifications after form submissions.
        Admin features require "admin@test.com" login first.
      `,
    },
  },
}
```

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
  model: 'gpt-oss-20b',  // Default: fast and smart model
  agents: {
    // Fastest model for summarization
    'experience-compactor': { model: 'llama-3.1-8b' }, 
  },
}
```

### Multi-language apps

```javascript
ai: {
  agents: {
    tester: {
      systemPrompt: `
        UI text may appear in English, Spanish, or French.
        Use ARIA roles and data-testid for locators, not text content.
      `,
    },
  },
}
```

### Focus on specific testing areas

```javascript
ai: {
  agents: {
    planner: {
      systemPrompt: `
        Prioritize payment flows and checkout.
        Include scenarios for failed payments.
      `,
    },
  },
}
```

### Custom React components

```javascript
ai: {
  agents: {
    researcher: {
      systemPrompt: `
        App uses custom components:
        - <DataGrid> for tables - look for data-testid="grid-*"
        - <Modal> for dialogs - look for role="dialog"
      `,
    },
  },
}
```

### Run in Docker/CI

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

### Enable observability with Langfuse

```javascript
ai: {
  langfuse: {
    enabled: true,
    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
    secretKey: process.env.LANGFUSE_SECRET_KEY,
  },
}
```

See [Observability](./observability.md) for details.

## Agent Configuration

Each agent can be individually configured with its own model and custom system prompt.

### Available Agents

| Agent | Purpose |
|-------|---------|
| `tester` | Executes test scenarios |
| `planner` | Generates test plans |
| `researcher` | Analyzes page structure |
| `navigator` | Handles browser navigation |
| `captain` | Orchestrates user commands |
| `experience-compactor` | Compresses experience data |
| `quartermaster` | Accessibility analysis |
| `historian` | Session recording |

### Agent Options

```javascript
agents: {
  tester: {
    model: 'gpt-oss-20b',          // Override default model
    enabled: true,                  // Enable/disable agent
    systemPrompt: '...',           // Append to system prompt
  },
}
```

| Option | Type | Description |
|--------|------|-------------|
| `model` | `string` | Model to use for this agent (overrides default) |
| `enabled` | `boolean` | Enable or disable the agent |
| `systemPrompt` | `string` | Additional instructions appended to the agent's system prompt |

### Researcher Agent Options

The researcher agent supports all standard agent options plus additional options for controlling interactive exploration:

| Option | Type | Description |
|--------|------|-------------|
| `excludeSelectors` | `string[]` | CSS selectors for containers to exclude |
| `includeSelectors` | `string[]` | CSS selectors for containers to always explore |
| `stopWords` | `string[]` | Words to filter out (replaces defaults if provided) |
| `maxElementsToExplore` | `number` | Maximum elements to explore per page (default: 10) |

```javascript
ai: {
  agents: {
    researcher: {
      excludeSelectors: ['.cookie-banner'],
      stopWords: ['cookie', 'newsletter'],
    },
  },
}
```

See [Researcher Agent](./researcher.md) for detailed documentation and examples.

See [AI Providers](./providers.md) for recommended models and provider setup.

## Playwright Settings

### Browser Selection

```javascript
playwright: {
  browser: 'chromium',  // Most compatible
  // browser: 'firefox',  // Better privacy testing
  // browser: 'webkit',   // Safari/iOS testing
}
```

### Viewport and Window Size

```javascript
playwright: {
  windowSize: '1920x1080',
  viewport: {
    width: 1920,
    height: 1080,
  },
}
```

## Directory Structure

Default directory layout:

```
your-project/
├── explorbot.config.js
├── knowledge/           # Domain hints (you create these)
│   └── login.md
├── experience/          # Learned patterns (auto-generated)
│   └── abc123.md
└── output/              # Test results (auto-generated)
    ├── research/
    ├── plans/
    └── sessions/
```

Customize paths:

```javascript
dirs: {
  knowledge: './test/knowledge',
  experience: './test/experience',
  output: './test/output',
}
```

## Environment Variables

Store sensitive values in environment variables:

```bash
# .env
GROQ_API_KEY=gsk_...
LANGFUSE_PUBLIC_KEY=pk-...
LANGFUSE_SECRET_KEY=sk-...
```

Reference in config:

```javascript
export default {
  ai: {
    provider: createGroq({ apiKey: process.env.GROQ_API_KEY }),
    langfuse: {
      enabled: true,
      publicKey: process.env.LANGFUSE_PUBLIC_KEY,
      secretKey: process.env.LANGFUSE_SECRET_KEY,
    },
  },
};
```

## Configuration File Locations

Explorbot searches for config files in this order:

1. `explorbot.config.js`
2. `explorbot.config.mjs`
3. `explorbot.config.ts`
4. `config/explorbot.config.js`
5. `config/explorbot.config.mjs`
6. `config/explorbot.config.ts`
7. `src/config/explorbot.config.js`
8. `src/config/explorbot.config.mjs`
9. `src/config/explorbot.config.ts`

Or specify a custom path:

```bash
explorbot explore --config ./custom/path/config.js
```

## Full Configuration Reference

```javascript
export default {
  // Browser automation settings
  playwright: {
    browser: 'chromium',           // 'chromium' | 'firefox' | 'webkit'
    url: 'http://localhost:3000',  // Starting URL (required)
    show: false,                   // Show browser window
    windowSize: '1280x720',        // Browser window size
    slowMo: 0,                     // Slow down actions (ms)
    timeout: 30000,                // Default timeout (ms)
    waitForNavigation: 'load',     // 'load' | 'domcontentloaded' | 'networkidle'
    waitForTimeout: 1000,          // Wait after navigation (ms)
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
    provider: groq,                // Vercel AI SDK provider (required)
    model: 'gpt-oss-20b',          // Default model (required)
    visionModel: 'llama-scout-4',  // Model for screenshot analysis
    vision: true,                  // Enable vision features
    maxAttempts: 3,                // Retry attempts for AI calls
    retryDelay: 1000,              // Delay between retries (ms)
    config: {},                    // Additional provider config
    langfuse: {                    // Observability settings
      enabled: true,
      publicKey: 'pk-...',
      secretKey: 'sk-...',
      baseUrl: 'https://cloud.langfuse.com',
    },
    agents: {                      // Per-agent configuration
      tester: {
        model: 'gpt-oss-20b',
        enabled: true,
        systemPrompt: '...',
      },
      planner: { /* ... */ },
      researcher: {                // Researcher-specific options
        model: 'gpt-oss-20b',      // Override default model
        enabled: true,             // Enable/disable agent
        systemPrompt: '...',       // Additional instructions
        excludeSelectors: [],      // CSS selectors to exclude
        includeSelectors: [],      // CSS selectors to always explore
        stopWords: [],             // Text patterns to skip (replaces defaults)
        maxElementsToExplore: 10,  // Max elements per page
      },
      navigator: { /* ... */ },
      captain: { /* ... */ },
      'experience-compactor': { /* ... */ },
      quartermaster: { /* ... */ },
      historian: { /* ... */ },
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

  // Directory paths
  dirs: {
    knowledge: 'knowledge',        // Domain knowledge files
    experience: 'experience',      // Learned patterns
    output: 'output',              // Test results and logs
  },
};
```

## See Also

- [AI Providers](./providers.md) - Provider setup examples
- [Agents](./agents.md) - Agent descriptions and workflows
- [Researcher Agent](./researcher.md) - Researcher configuration and usage
- [Knowledge Files](./knowledge.md) - Domain knowledge format
- [Observability](./observability.md) - Langfuse integration
