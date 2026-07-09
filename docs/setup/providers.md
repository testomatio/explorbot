# AI Provider Configuration

Explorbot connects to AI providers through the [Vercel AI SDK](https://sdk.vercel.ai/). Use any supported provider, and mix providers across different models.

## Requirements

Your model must support:
- Structured output (JSON mode)
- Tool use (function calling)

To analyze screenshots, you also need a vision-capable model.

### OpenRouter (recommended)

Start with OpenRouter. One key reaches [many providers and models](https://openrouter.ai/models).

```bash
bun add @openrouter/ai-sdk-provider
```

```javascript
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

export default {
  ai: {
    model: openrouter('openai/gpt-oss-20b:nitro'),
    visionModel: openrouter('google/gemma-4-31b-it'),
    agenticModel: openrouter('minimax/minimax-m2.5:nitro'),
  },
};
```

Pick model IDs from [OpenRouter](https://openrouter.ai/) that support structured output and tools.

### Groq

```bash
bun add @ai-sdk/groq
```

```javascript
import { createGroq } from '@ai-sdk/groq';

const groq = createGroq({
  apiKey: process.env.GROQ_API_KEY,
});

export default {
  ai: {
    model: groq('openai/gpt-oss-20b'),
    visionModel: groq('meta-llama/llama-4-scout-17b-16e-instruct'),
    agenticModel: groq('openai/gpt-oss-120b'),
  },
};
```

### Cerebras

```bash
bun add @ai-sdk/cerebras
```

```javascript
import { createCerebras } from '@ai-sdk/cerebras';

const cerebras = createCerebras({
  apiKey: process.env.CEREBRAS_API_KEY,
});

export default {
  ai: {
    model: cerebras('gpt-oss-120b'),
    visionModel: cerebras('llama-4-scout-17b-16e-instruct'),
    agenticModel: cerebras('gpt-oss-120b'),
  },
};
```

### OpenAI

```bash
bun add @ai-sdk/openai
```

```javascript
import { createOpenAI } from '@ai-sdk/openai';

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default {
  ai: {
    model: openai('gpt-4o-mini'),
    visionModel: openai('gpt-4o-mini'),
    agenticModel: openai('gpt-4o-mini'),
  },
};
```

Note: OpenAI models are slower and more expensive than many hosted OSS options.

### Anthropic

```bash
bun add @ai-sdk/anthropic
```

```javascript
import { createAnthropic } from '@ai-sdk/anthropic';

const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export default {
  ai: {
    model: anthropic('claude-sonnet-4-20250514'),
    visionModel: anthropic('claude-sonnet-4-20250514'),
    agenticModel: anthropic('claude-sonnet-4-20250514'),
  },
};
```

Note: Anthropic models are slower but accurate. Use them when accuracy matters more than speed.

### Azure OpenAI

```bash
bun add @ai-sdk/azure
```

```javascript
import { createAzure } from '@ai-sdk/azure';

const azure = createAzure({
  resourceName: process.env.AZURE_RESOURCE_NAME,
  apiKey: process.env.AZURE_API_KEY,
});

export default {
  ai: {
    model: azure('your-deployment-name'),
    visionModel: azure('your-deployment-name'),
    agenticModel: azure('your-deployment-name'),
  },
};
```

Use separate deployment names if your Azure setup uses different endpoints for chat and vision.

### Google (Gemini)

```bash
bun add @ai-sdk/google
```

```javascript
import { createGoogleGenerativeAI } from '@ai-sdk/google';

const google = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_API_KEY,
});

export default {
  ai: {
    model: google('gemini-2.0-flash'),
    visionModel: google('gemini-2.0-flash'),
    agenticModel: google('gemini-2.0-flash'),
  },
};
```

## Multi-Provider Configuration

Mix clients the same way you assign `model`, `visionModel`, and `agenticModel`. Each field can use a different provider instance:

```javascript
import { createGroq } from '@ai-sdk/groq';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });
const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });

export default {
  ai: {
    model: groq('openai/gpt-oss-20b'),
    visionModel: groq('meta-llama/llama-4-scout-17b-16e-instruct'),
    agenticModel: openrouter('moonshotai/kimi-k2-instruct-0905'),
  },
};
```

## Per-Agent Model Configuration

```javascript
import { createGroq } from '@ai-sdk/groq';

const groq = createGroq({
  apiKey: process.env.GROQ_API_KEY,
});

export default {
  ai: {
    model: groq('openai/gpt-oss-20b'),
    visionModel: groq('meta-llama/llama-4-scout-17b-16e-instruct'),
    agenticModel: groq('openai/gpt-oss-20b'),
    agents: {
      navigator: { model: groq('openai/gpt-oss-20b') },
      researcher: { model: groq('openai/gpt-oss-20b') },
      planner: { model: groq('openai/gpt-oss-20b') },
      tester: { model: groq('openai/gpt-oss-20b') },
    },
  },
};
```

## Environment Variables

Set your API key as an environment variable:

```bash
# OpenRouter
export OPENROUTER_API_KEY=your-key-here

# Groq
export GROQ_API_KEY=your-key-here

# Cerebras
export CEREBRAS_API_KEY=your-key-here

# OpenAI
export OPENAI_API_KEY=your-key-here

# Anthropic
export ANTHROPIC_API_KEY=your-key-here

# Google
export GOOGLE_API_KEY=your-key-here
```

Or use a `.env` file in your project root.
