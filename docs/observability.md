# Observability & Debugging

Explorbot integrates with [Langfuse](https://langfuse.com) for tracing and observability. This lets you analyze what happened during a session — what data was received, which tools were called, and how the agents made decisions.

![Langfuse Trace View](assets/langfuse-trace.png)

## Why Observability?

When Explorbot runs autonomously, you need visibility into:

- **What prompts were sent** to the AI
- **What tools were called** and with what parameters
- **Token usage** and costs per session
- **Timing** of each operation
- **Errors and retries** that occurred

This data helps you:
- Debug unexpected behavior
- Optimize prompts and agent performance
- Understand why a test passed or failed
- Export sessions for analysis with coding agents

## Setting Up Langfuse

### 1. Create a Langfuse Account

Sign up at [langfuse.com](https://langfuse.com) (free tier available) or self-host.

### 2. Get Your API Keys

From your Langfuse project settings, copy:
- **Public Key**
- **Secret Key**

### 3. Configure Explorbot

Add credentials to your `.env` file:

```bash
LANGFUSE_PUBLIC_KEY=pk-lf-xxxxxxxx
LANGFUSE_SECRET_KEY=sk-lf-xxxxxxxx
```

Or configure in `explorbot.config.js`:

```javascript
export default {
  ai: {
    provider: groq,
    model: 'gpt-oss-20b',
    langfuse: {
      enabled: true,
      publicKey: process.env.LANGFUSE_PUBLIC_KEY,
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      baseUrl: 'https://cloud.langfuse.com', // or your self-hosted URL
    },
  },
};
```

### 4. Run Explorbot

Once configured, all AI calls are automatically traced. No code changes needed.

## What Gets Traced

Explorbot uses the [Vercel AI SDK integration](https://langfuse.com/docs/integrations/vercel-ai-sdk) with Langfuse. Each session captures:

| Trace | Description |
|-------|-------------|
| `tester.loop` | Full test execution cycle |
| `research` | Page analysis by Researcher agent |
| `navigator.loop` | Navigation and interaction attempts |
| `ai.generateText` | Text generation calls |
| `ai.generateObject` | Structured output calls |
| `codeceptjs.step` | Individual browser actions |
| `I.click`, `I.fillField`, etc. | Specific CodeceptJS commands |

## Analyzing Sessions

### In Langfuse Dashboard

1. Open your Langfuse project
2. Find the session by timestamp or name
3. Click to see the full trace tree
4. Inspect individual spans for:
   - Input prompts
   - Output responses
   - Token counts
   - Duration
   - Errors

### Export for AI Analysis

Export a session as JSON from Langfuse, then ask a coding agent to analyze it:

```
I have a Langfuse trace export from my Explorbot session.
The test "Verify login with valid credentials" failed.
Please analyze the trace and suggest what went wrong.
```

The trace contains the full context of what the agent saw and decided, making it easy to diagnose issues.

## Debugging Tips

### Enable Verbose Logging

```bash
explorbot explore --verbose
```

Or set the environment variable:

```bash
DEBUG=explorbot:* explorbot explore
```

This shows detailed logs including:
- Prompts sent to AI
- Tool calls and results
- State transitions

### Specific Debug Namespaces

```bash
# AI provider calls only
DEBUG=explorbot:provider explorbot explore

# Navigator agent only
DEBUG=explorbot:navigator explorbot explore

# Multiple namespaces
DEBUG=explorbot:tester,explorbot:navigator explorbot explore
```

### Available Namespaces

| Namespace | What it shows |
|-----------|---------------|
| `explorbot:provider` | AI API calls, responses |
| `explorbot:provider:out` | Outgoing prompts |
| `explorbot:provider:in` | Incoming responses |
| `explorbot:navigator` | Navigation decisions |
| `explorbot:researcher` | Page analysis |
| `explorbot:planner` | Test scenario generation |
| `explorbot:tester` | Test execution |
| `explorbot:historian` | Experience saving |
| `explorbot:quartermaster` | A11y analysis |

## Cost Tracking

Langfuse tracks token usage per call. Use this to:

- Monitor costs across sessions
- Compare model efficiency
- Identify expensive operations
- Optimize prompts to reduce tokens

## Self-Hosting Langfuse

For privacy or compliance, you can [self-host Langfuse](https://langfuse.com/docs/deployment/self-host):

```bash
# Docker
docker run -d -p 3000:3000 langfuse/langfuse
```

Then set `baseUrl` in your config:

```javascript
langfuse: {
  baseUrl: 'http://localhost:3000',
}
```
