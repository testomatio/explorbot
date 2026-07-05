import { createOpenRouter } from '@openrouter/ai-sdk-provider';

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

const config = {
  web: {
    url: process.env.APP_URL,
  },

  playwright: {
    browser: 'chromium',
    windowSize: '1600x1200',
  },

  reporter: {
    enabled: true,
    markdown: true,
  },

  dirs: {
    knowledge: 'knowledge',
    experience: 'experience',
    output: 'output',
  },

  ai: {
    model: openrouter('openai/gpt-oss-20b:nitro'),
    visionModel: openrouter('meta-llama/llama-4-scout:nitro'),
    agenticModel: openrouter('minimax/minimax-m2.5:nitro'),

    agents: {
      researcher: {
        reasoning: 'low',
      },
      planner: {
        reasoning: 'none',
      },
      pilot: {
        reasoning: 'none',
      },
      quartermaster: {
        enabled: false,
      },
      fisherman: {
        enabled: false,
      },
      analyst: {
        enabled: false,
      },
      historian: {
        enabled: false,
      },
    },
  },
};

export default config;
