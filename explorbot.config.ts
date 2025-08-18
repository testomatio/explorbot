interface PlaywrightConfig {
  browser: 'chromium' | 'firefox' | 'webkit';
  url: string;
  show?: boolean;
  windowSize?: string;
  slowMo?: number;
  chromium?: {
    args?: string[];
  };
  firefox?: {
    args?: string[];
  };
  webkit?: {
    args?: string[];
  };
  timeout?: number;
  waitForNavigation?: 'load' | 'domcontentloaded' | 'networkidle';
  waitForTimeout?: number;
  ignoreHTTPSErrors?: boolean;
  userAgent?: string;
  viewport?: {
    width: number;
    height: number;
  };
  args?: string[];
}

interface AIConfig {
  provider: any;
  model: string;
  apiKey?: string;
  config?: Record<string, any>;
  tools?: {
    enabled: boolean;
    maxConcurrency: number;
    timeout: number;
  };
  maxAttempts?: number;
  retryDelay?: number;
}

interface ExplorbotConfig {
  playwright: PlaywrightConfig;
  ai: AIConfig;
  dirs?: {
    knowledge: string;
    experience: string;
    output: string;
  };
}

const config: ExplorbotConfig = {
  playwright: {
    browser: 'chromium',
    url: 'http://localhost:3000',
  },

  ai: {
    provider: null,
    model: 'gpt-4o',
  },
};

export default config;
export type { ExplorbotConfig, PlaywrightConfig, AIConfig };
