import { openai } from 'ai';
import { anthropic } from 'ai';
import { bedrock } from 'ai';

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

interface AppConfig {
  name: string;
  version: string;
  description: string;
  defaultTimeout: number;
  retryAttempts: number;
  screenshotOnFailure: boolean;
  videoRecording: boolean;
}

interface OutputConfig {
  screenshots: string;
  videos: string;
  logs: string;
  reports: string;
}

interface TestConfig {
  grep: string | null;
  timeout: number;
  retries: number;
  parallel: boolean;
  workers: number;
}

interface AIConfig {
  provider: any;
  model: string;
  apiKey: string;
  config: Record<string, any>;
  tools: {
    enabled: boolean;
    maxConcurrency: number;
    timeout: number;
  };
  streaming: boolean;
  retryAttempts: number;
  retryDelay: number;
}

interface HtmlConfig {
  minimal?: {
    include?: string[];
    exclude?: string[];
  };
  combined?: {
    include?: string[];
    exclude?: string[];
  };
  text?: {
    include?: string[];
    exclude?: string[];
  };
}

interface DirsConfig {
  knowledge: string;
  experience: string;
  output: string;
}

interface ActionConfig {
  delay?: number;
  retries?: number;
}

interface ExplorbotConfig {
  playwright: PlaywrightConfig;
  app: AppConfig;
  output: OutputConfig;
  test: TestConfig;
  ai: AIConfig;
  action?: ActionConfig;
  html?: HtmlConfig;
  dirs?: DirsConfig;
}

const config: ExplorbotConfig = {
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
      height: 900,
    },
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote', '--disable-gpu'],
  },

  app: {
    name: 'Explorbot',
    version: '1.0.0',
    description: 'CLI app built with React Ink, CodeceptJS, and Playwright',
    defaultTimeout: 30000,
    retryAttempts: 3,
    screenshotOnFailure: true,
    videoRecording: false,
  },

  output: {
    screenshots: './output/screenshots',
    videos: './output/videos',
    logs: './output/logs',
    reports: './output/reports',
  },

  test: {
    grep: null,
    timeout: 30000,
    retries: 1,
    parallel: false,
    workers: 1,
  },

  ai: {
    // Choose one of these providers:

    // Option 1: OpenAI
    provider: openai,
    model: 'gpt-5',
    apiKey: process.env.OPENAI_API_KEY || '',

    // Option 2: Anthropic
    // provider: anthropic,
    // model: 'claude-3-5-sonnet-20241022',
    // apiKey: process.env.ANTHROPIC_API_KEY || '',

    // Option 3: AWS Bedrock
    // provider: bedrock,
    // model: 'anthropic.claude-3-sonnet-20240229-v1:0',
    // apiKey: process.env.AWS_ACCESS_KEY_ID || '',

    config: {
      temperature: 0.7,
      maxTokens: 4000,
      baseURL: process.env.OPENAI_BASE_URL,
      organization: process.env.OPENAI_ORG_ID,
    },
    tools: {
      enabled: true,
      maxConcurrency: 5,
      timeout: 30000,
    },
    streaming: true,
    retryAttempts: 3,
    retryDelay: 1000,

    // Optional: Agent-specific model configuration
    // Each agent can override the default model
    agents: {
      tester: {
        // model: 'gpt-5',  // Override for tester agent
      },
      navigator: {
        // model: 'gpt-5',  // Override for navigator agent
      },
      researcher: {
        // model: 'gpt-5',  // Override for researcher agent
      },
      planner: {
        // model: 'gpt-5',  // Override for planner agent
      },
    },
  },

  // Action configuration
  action: {
    delay: 1000, // Delay between actions in milliseconds
    retries: 3, // Number of retry attempts for failed actions
  },

  // Optional HTML parsing configuration
  // Use CSS selectors to customize which elements are included in snapshots
  html: {
    // Minimal UI snapshot - keeps only interactive elements
    minimal: {
      include: [
        // Include elements with test IDs (not included by default)
        '[data-testid]',
        '[data-cy]',
        // Include custom interactive components
        '[role="toolbar"]',
        // Include elements with specific data attributes
        'div[data-id]',
      ],
      exclude: [
        // Exclude cookie banners
        '#onetrust-consent-sdk',
        // Exclude notification toasts
        '.toast',
        '.notification',
        // Exclude loading spinners
        '.spinner',
        '.loading',
      ],
    },
    // Combined snapshot - keeps interactive elements + meaningful text
    combined: {
      include: [
        // Include content areas with specific classes
        '.content',
        '.main-content',
        '[data-content]',
        // Include article content
        'article',
        '.article',
      ],
      exclude: [
        // Exclude navigation menus
        '.nav-menu',
        '.navigation',
        'nav',
        // Exclude metadata
        '.metadata',
        '.meta',
        'time',
      ],
    },
    // Text snapshot - converts to markdown text
    text: {
      include: [
        // Include specific text containers
        '.prose',
        '.markdown',
        '[data-markdown]',
      ],
      exclude: [
        // Exclude code blocks (if not needed)
        'code',
        'pre',
        // Exclude small text
        'small',
        '.fine-print',
      ],
    },
  },
};

export default config;
export type { ExplorbotConfig, PlaywrightConfig, AppConfig, OutputConfig, TestConfig, AIConfig, ActionConfig, HtmlConfig, DirsConfig };
