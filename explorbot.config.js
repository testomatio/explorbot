import { createGroq } from '@ai-sdk/groq';

const groq = createGroq({
  apiKey: process.env.GROQ_API_KEY,
});

const config = {
  playwright: {
    browser: 'chromium',
    url: 'http://localhost:3000',
    windowSize: '1600x1200',
  },

  ai: {
    provider: groq,
    model: process.env.GROQ_MODEL,
    visionModel: process.env.GROQ_VISION_MODEL,
    config: {
      maxRetries: 3,
      timeout: 30000,
    },
    agents: {
      tester: {},
      navigator: {},
      researcher: {},
      planner: {},
    },
  },
};

export default config;
