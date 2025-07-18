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

interface ExplorbotConfig {
  playwright: PlaywrightConfig;
  app: AppConfig;
  output: OutputConfig;
  test: TestConfig;
  ai: AIConfig;
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
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
    ],
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
    model: 'gpt-4o',
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
  },
};

export default config;
export type {
  ExplorbotConfig,
  PlaywrightConfig,
  AppConfig,
  OutputConfig,
  TestConfig,
  AIConfig,
};
