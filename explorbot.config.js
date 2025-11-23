import dotenv from 'dotenv';
dotenv.config();

import { groq } from '@ai-sdk/groq';

const config = {
  playwright: {
    browser: 'chromium',
    url: 'http://localhost:3000',
    windowSize: '1200x900',
  },

  ai: {
    provider: groq,
    model: process.env.GROQ_MODEL || 'llama-3.1-70b-versatile',
    apiKey: process.env.GROQ_API_KEY || '',
    config: {
      maxRetries: 3,
      timeout: 30000, // 30 seconds timeout
    },
    agents: {
      tester: {
        // model: 'llama-3.1-70b-versatile',
      },
      navigator: {
        // model: 'llama-3.1-70b-versatile',
      },
      researcher: {
        // model: 'llama-3.1-70b-versatile',
      },
      planner: {
        // model: 'llama-3.1-70b-versatile',
      },
    },
  },
};

export default config;
