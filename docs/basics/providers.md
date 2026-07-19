# AI Provider Configuration

Explorbot connects to AI providers through the [Vercel AI SDK](https://sdk.vercel.ai/). Use any supported provider, and mix providers across different models.

> The `export default` config block inside each `<!-- START/END provider -->` marker is generated from [`models.json`](../../models.json). After editing that file, run `bunosh docs:models`. Everything else — including the import blocks — is hand-written.

## Requirements

Your model must support:
- Structured output (JSON mode)
- Tool use (function calling)

To analyze screenshots, you also need a vision-capable model.

Explorbot uses three roles: 

- `model` for token-heavy page reading of ARIA & HTMLs (cheap & fast).
- `visionModel` for screenshot analysis
- `agenticModel` as advisor and planner. 

Pick a fast, cheap model for the first two and a stronger one for the third. When a provider has no recommended model for one of these roles, combine it with another provider for that role.

### OpenRouter

Start with OpenRouter. One key reaches [many providers and models](https://openrouter.ai/models).
Openrouter is an optimal solution as you can balance the models and provider for best price and speed.
So if your goal is to optimize costs, choose Openrouter.

> Openrouter is recommended to start as it serves best models 

Install the provider package:

```bash
npm i @openrouter/ai-sdk-provider
```

Import it inside `explorbot.config.ts` and create the client from your API key:

```javascript
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});
```

Set the recommended models in the exported config:

<!-- START provider:openrouter -->
```javascript
export default {
  ai: {
    model: openrouter('openai/gpt-oss-20b:nitro'),
    visionModel: openrouter('google/gemma-4-31b-it:nitro'),
    agenticModel: openrouter('google/gemma-4-31b-it:nitro'),
  },
};
```
<!-- END provider:openrouter -->

Pick model IDs from [OpenRouter](https://openrouter.ai/) that support structured output and tools. The `:nitro` variants route to the fastest available host.

### Groq

Install the provider package:

```bash
npm i @ai-sdk/groq
```

Import it inside `explorbot.config.ts` and create the client from your API key:

```javascript
import { createGroq } from '@ai-sdk/groq';

const groq = createGroq({
  apiKey: process.env.GROQ_API_KEY,
});
```

Set the recommended models in the exported config:

<!-- START provider:groq -->
```javascript
export default {
  ai: {
    model: groq('openai/gpt-oss-20b'),
    visionModel: groq('qwen/qwen3.6-27b'),
    agenticModel: groq('qwen/qwen3.6-27b'),
  },
};
```
<!-- END provider:groq -->

The gpt-oss models are fast and cheap; the larger 120B handles the agenticModel role.

### OpenAI

Install the provider package:

```bash
npm i @ai-sdk/openai
```

Import it inside `explorbot.config.ts` and create the client from your API key:

```javascript
import { createOpenAI } from '@ai-sdk/openai';

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
```

Set the recommended models in the exported config:

<!-- START provider:openai -->
```javascript
export default {
  ai: {
    model: openai('gpt-5.4-nano'),
    visionModel: openai('gpt-5.4-nano'),
    agenticModel: openai('gpt-5.6-luna'),
  },
};
```
<!-- END provider:openai -->

### Anthropic

Claude Haiku is the only Anthropic model suited to Explorbot, and even it is too costly per token for the token-heavy roles, so we recommend it only for the low-volume agenticModel. Use a cheaper provider for `model` and `visionModel` (see [Multi-Provider Configuration](#multi-provider-configuration)).

Install the provider package:

```bash
npm i @ai-sdk/anthropic
```

Import it inside `explorbot.config.ts` and create the client from your API key:

```javascript
import { createAnthropic } from '@ai-sdk/anthropic';

const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});
```

Set the recommended model in the exported config:

<!-- START provider:anthropic -->
```javascript
export default {
  ai: {
    agenticModel: anthropic('claude-haiku-4-5-20251001'),
  },
};
```

> [!NOTE]
> This provider currently doesn't serve `model` and `visionModel`, which is required for Explorbot to run at optimal cost and speed.
> It is recommended to pair it with another AI provider.
<!-- END provider:anthropic -->

### Azure OpenAI

Install the provider package:

```bash
npm i @ai-sdk/azure
```

Import it inside `explorbot.config.ts` and create the client from your resource name and API key:

```javascript
import { createAzure } from '@ai-sdk/azure';

const azure = createAzure({
  resourceName: process.env.AZURE_RESOURCE_NAME,
  apiKey: process.env.AZURE_API_KEY,
});
```

Set the models in the exported config, using the deployment names you created in your resource:

```javascript
export default {
  ai: {
    model: azure('your-deployment-name'),
    visionModel: azure('your-deployment-name'),
    agenticModel: azure('your-deployment-name'),
  },
};
```

Azure addresses models by the deployment names you create in your resource, not by public model IDs. Use separate deployments if chat and vision run on different endpoints.

### Google (Gemini)

An API key from [Google AI Studio](https://aistudio.google.com/apikey) already has the Gemini API enabled. A key from the Google Cloud console may need the API enabled first, and service-account (Vertex Express) keys use a different API surface than the one this provider targets.

Install the provider package:

```bash
npm i @ai-sdk/google
```

Import it inside `explorbot.config.ts` and create the client from your API key:

```javascript
import { createGoogleGenerativeAI } from '@ai-sdk/google';

const google = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_API_KEY,
});
```

Set the recommended models in the exported config:

<!-- START provider:google -->
```javascript
export default {
  ai: {
    model: google('gemini-3.1-flash-lite'),
    visionModel: google('gemini-3.1-flash-lite'),
    agenticModel: google('gemini-3.5-flash'),
  },
};
```
<!-- END provider:google -->

The flash-lite tier is the cheapest current option for the token-heavy `model` and `visionModel` roles; the full flash is stronger for the low-volume `agenticModel`.

On a free (no-billing) key the `agenticModel` is heavily rate-limited and will fail with quota errors mid-session — keep every role on the flash-lite model or enable billing. Google also retires older models for new accounts: `gemini-2.5-flash` and `gemini-2.5-flash-lite` return a 404 for keys created after their cutoff, and enabling billing does not bring them back.

Note: Gemini models are slower than hosted OSS models on Groq or Cerebras. Everything works, sessions just take more wall-clock time.

### Mistral

Install the provider package:

```bash
npm i @ai-sdk/mistral
```

Import it inside `explorbot.config.ts` and create the client from your API key:

```javascript
import { createMistral } from '@ai-sdk/mistral';

const mistral = createMistral({
  apiKey: process.env.MISTRAL_API_KEY,
});
```

Set the recommended models in the exported config:

<!-- START provider:mistral -->
```javascript
export default {
  ai: {
    model: mistral('mistral-small-latest'),
    visionModel: mistral('mistral-small-latest'),
    agenticModel: mistral('mistral-large-latest'),
  },
};
```
<!-- END provider:mistral -->

Mistral Small covers the token-heavy `model` and `visionModel` roles — it accepts image input, so it can read screenshots. Mistral Large, the larger multimodal flagship, handles the low-volume `agenticModel`. The `-latest` aliases track Mistral's newest release of each, so recommendations keep up as models ship.

## Multi-Provider Configuration

Mix clients the same way you assign `model`, `visionModel`, and `agenticModel`. Each field can use a different provider instance — a fast provider does the token-heavy reading while a stronger one makes the decisions:

```javascript
import { createGroq } from '@ai-sdk/groq';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });
const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });

export default {
  ai: {
    model: groq('openai/gpt-oss-20b'),
    visionModel: groq('meta-llama/llama-4-scout-17b-16e-instruct'),
    agenticModel: openrouter('minimax/minimax-m2.5:nitro'),
  },
};
```

## Per-Agent Model Configuration

Any agent can override the defaults. Add an `agents` block and set per-agent options — a different `model` (using any client shown above) or a `reasoning` level:

```javascript
export default {
  ai: {
    // ...your model, visionModel, agenticModel...
    agents: {
      researcher: { reasoning: 'low' },
      planner: { reasoning: 'none' },
      tester: { reasoning: 'none' },
    },
  },
};
```

See [Configuration](../reference/configuration.md) for every per-agent option.

## Environment Variables

Set your API key as an environment variable, or use a `.env` file in your project root:

```bash
export OPENROUTER_API_KEY=your-key-here
export GROQ_API_KEY=your-key-here
export CEREBRAS_API_KEY=your-key-here
export OPENAI_API_KEY=your-key-here
export ANTHROPIC_API_KEY=your-key-here
export GOOGLE_API_KEY=your-key-here
export MISTRAL_API_KEY=your-key-here
```
