# Explorbot Configuration

Explorbot uses a flexible configuration system that allows you to customize Playwright settings, application behavior, and test parameters.

## Configuration Files

The system supports multiple configuration file formats:

- `explorbot.config.ts` (TypeScript - recommended)
- `explorbot.config.js` (JavaScript)
- `explorbot.config.mjs` (ES Modules)

## Auto-Detection

The configuration system automatically detects and loads configuration files from the following locations (in order of priority):

1. `explorbot.config.ts`
2. `explorbot.config.js`
3. `explorbot.config.mjs`
4. `config/explorbot.config.ts`
5. `config/explorbot.config.js`
6. `config/explorbot.config.mjs`
7. `src/config/explorbot.config.ts`
8. `src/config/explorbot.config.js`
9. `src/config/explorbot.config.mjs`

## Configuration Structure

```typescript
interface ExplorbotConfig {
  playwright: PlaywrightConfig;
  ai: AIConfig;
  app: AppConfig;
  output: OutputConfig;
  test: TestConfig;
  html?: HtmlConfig;
  action?: ActionConfig;
  dirs?: DirsConfig;
}
```

### Playwright Configuration

```typescript
interface PlaywrightConfig {
  browser: 'chromium' | 'firefox' | 'webkit';
  url: string;
  show: boolean;
  windowSize: string;
  headless: boolean;
  slowMo: number;
  timeout: number;
  waitForNavigation: 'load' | 'domcontentloaded' | 'networkidle';
  waitForTimeout: number;
  ignoreHTTPSErrors: boolean;
  userAgent: string;
  viewport: {
    width: number;
    height: number;
  };
  args: string[];
}
```

### AI Configuration

```typescript
interface AIConfig {
  provider: any;                    // AI provider function (e.g., openai, anthropic, groq)
  model: string;                    // Default model name
  apiKey?: string;                  // API key for the provider
  config?: Record<string, any>;     // Additional provider-specific config
  visionModel?: string;             // Model to use for vision/screenshot analysis
  maxAttempts?: number;             // Max retry attempts for AI calls
  retryDelay?: number;              // Delay between retries
  agents?: AgentsConfig;            // Agent-specific model overrides
}

interface AgentsConfig {
  tester?: { model?: string };      // Override model for Tester agent
  navigator?: { model?: string };   // Override model for Navigator agent
  researcher?: { model?: string };  // Override model for Researcher agent
  planner?: { model?: string };     // Override model for Planner agent
}
```

**Agent-Specific Models**: Each agent (tester, navigator, researcher, planner) can use a different AI model. If not specified, the default model from `ai.model` is used. This allows you to:
- Use faster/cheaper models for simple tasks
- Use more capable models for complex reasoning
- Balance cost and performance across different agents

Example:
```typescript
ai: {
  provider: openai,
  model: 'gpt-5-mini',         // Default model for all agents
  agents: {
    tester: {
      model: 'gpt-5'            // Use more capable model for testing
    },
    // navigator, researcher, planner will use gpt-5-mini
  }
}
```

### Application Configuration

```typescript
interface AppConfig {
  name: string;
  version: string;
  description: string;
  defaultTimeout: number;
  retryAttempts: number;
  screenshotOnFailure: boolean;
  videoRecording: boolean;
}
```

### Output Configuration

```typescript
interface OutputConfig {
  screenshots: string;
  videos: string;
  logs: string;
  reports: string;
}
```

### Test Configuration

```typescript
interface TestConfig {
  grep: string | null;
  timeout: number;
  retries: number;
  parallel: boolean;
  workers: number;
}
```

## Example Configuration

```typescript
// explorbot.config.ts
import { openai } from '@ai-sdk/openai';

export default {
  ai: {
    provider: openai,
    model: 'gpt-5',
    apiKey: process.env.OPENAI_API_KEY,
    visionModel: 'gpt-5',
    config: {
      temperature: 0.7,
      maxTokens: 4000,
    },
    // Optional: Override models for specific agents
    agents: {
      tester: {
        model: 'gpt-5'
      },
      navigator: {
        model: 'gpt-5-mini'
      }
    }
  },
  playwright: {
    browser: 'chromium',
    url: 'http://localhost:3000',
    show: true,
    windowSize: '1200x900',
    headless: false,
    slowMo: 100,
    timeout: 10000,
    waitForNavigation: 'networkidle',
    waitForTimeout: 5000,
    ignoreHTTPSErrors: true,
    userAgent: 'Explorbot/1.0',
    viewport: {
      width: 1200,
      height: 900
    },
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage'
    ]
  },
  app: {
    name: 'Explorbot',
    version: '1.0.0',
    description: 'CLI app built with React Ink, CodeceptJS, and Playwright',
    defaultTimeout: 30000,
    retryAttempts: 3,
    screenshotOnFailure: true,
    videoRecording: false
  },
  output: {
    screenshots: './output/screenshots',
    videos: './output/videos',
    logs: './output/logs',
    reports: './output/reports'
  },
  test: {
    grep: null,
    timeout: 30000,
    retries: 1,
    parallel: false,
    workers: 1
  }
};
```

## Usage

### Basic Usage

```javascript
import Explore from './src/explore.js';

const explore = new Explore();
const I = await explore.run();
```

### Custom Configuration Path

```javascript
import Explore from './src/explore.js';

// Specify custom config path
const explore = new Explore('./custom-config.js');
const I = await explore.run();
```

### Runtime Configuration Override

```javascript
import Explore from './src/explore.js';

const explore = new Explore();
// Override config at runtime
const I = await explore.run('./production-config.js');
```

## Configuration Validation

The system automatically validates your configuration and will throw helpful error messages for:

- Missing required fields
- Invalid browser types
- Invalid URLs
- Invalid configuration structure

## Default Values

If no configuration file is found, the system will use sensible defaults:

- Browser: `chromium`
- URL: `http://localhost:3000`
- Window size: `1200x900`
- Headless: `false`
- Timeout: `30000ms`

## Environment Variables

You can override configuration values using environment variables:

```bash
EXPLORBOT_BROWSER=firefox
EXPLORBOT_URL=https://example.com
EXPLORBOT_HEADLESS=true
```

## Configuration API

The `Explore` class provides methods to access configuration:

```javascript
const explore = new Explore();
await explore.run();

// Get current configuration
const config = explore.getConfig();
console.log(config.app.name); // "Explorbot"

// Get configuration file path
const configPath = explore.getConfigPath();
console.log(configPath); // "/path/to/explorbot.config.ts"
``` 