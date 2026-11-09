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
    recommendedModels: 'openrouter',
    model: process.env.BENCH_MODEL,
    visionModel: process.env.BENCH_VISION_MODEL,
    agenticModel: process.env.BENCH_AGENTIC_MODEL,

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
        enabled: true,
      },
      historian: {
        enabled: false,
      },
    },
  },
};

export default config;
