import { createGroq } from '@ai-sdk/groq';

const groq = createGroq({
  apiKey: process.env.GROQ_API_KEY,
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
    model: groq('openai/gpt-oss-20b'),
    visionModel: groq('meta-llama/llama-4-scout-17b-16e-instruct'),
    agenticModel: groq('openai/gpt-oss-120b'),

    config: {
      maxOutputTokens: 8000,
    },

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
