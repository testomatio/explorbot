# AI Provider Configuration

Explorbot uses the [Vercel AI SDK](https://sdk.vercel.ai/) to connect to AI providers. This gives you flexibility to use any supported provider.

## Requirements

Your model must support:
- **Structured output** (JSON mode)
- **Tool use** (function calling)

For vision features (screenshot analysis), you also need a vision-capable model.

## Recommended Setup

For best performance, use high-throughput inference providers (500-1000 TPS):

```javascript
import { createGroq } from '@ai-sdk/groq';

const groq = createGroq({
  apiKey: process.env.GROQ_API_KEY,
});

export default {
  ai: {
    provider: groq,
    model: 'gpt-oss-20b',
    visionModel: 'llama-scout-4',
  },
};
```

## Provider Examples

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
    provider: groq,
    model: 'gpt-oss-20b',
    visionModel: 'llama-scout-4',
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
    provider: cerebras,
    model: 'gpt-oss-20b',
    visionModel: 'llama-scout-4',
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
    provider: openai,
    model: 'gpt-4o-mini',
    visionModel: 'gpt-4o-mini',
  },
};
```

Note: OpenAI models are slower and more expensive. Use `gpt-4o-mini` for better cost efficiency.

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
    provider: anthropic,
    model: 'claude-sonnet-4-20250514',
    visionModel: 'claude-sonnet-4-20250514',
  },
};
```

Note: Anthropic models are powerful but slower. Consider for complex apps where accuracy matters more than speed.

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
    provider: azure,
    model: 'your-deployment-name',
  },
};
```

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
    provider: google,
    model: 'gemini-2.0-flash',
    visionModel: 'gemini-2.0-flash',
  },
};
```

## Per-Agent Model Configuration

You can use different models for different agents to optimize cost:

```javascript
export default {
  ai: {
    provider: groq,
    model: 'gpt-oss-20b',
    visionModel: 'llama-scout-4',
    agents: {
      navigator: { model: 'gpt-oss-20b' },
      researcher: { model: 'gpt-oss-20b', visionModel: 'llama-scout-4' },
      planner: { model: 'gpt-oss-20b' },
      tester: { model: 'gpt-oss-20b' },
    },
  },
};
```

## Environment Variables

Set your API key as an environment variable:

```bash
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
