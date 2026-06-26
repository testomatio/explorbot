# Observability & Debugging

Explorbot integrates with [Langfuse](https://langfuse.com) for tracing. Use it to see what happened during a session: what data each agent received, which tools it called, and how it decided.

![Langfuse Trace View](../assets/langfuse-trace.png)

## Why Observability?

When Explorbot runs on its own, you need to see:

- What prompts went to the AI.
- What tools were called, and with what parameters.
- Token usage and cost per session.
- How long each operation took.
- Errors and retries.

Use this data to:

- Debug failed tests. See what the AI saw and decided.
- Create Knowledge fixes. Find the context that was missing.
- Tune prompts and agent performance.
- Understand why a test passed or failed.
- Export sessions for the `/explorbot-debug` skill.

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
    model: groq('gpt-oss-20b'),
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

Once configured, Explorbot traces every AI call. No code changes needed.

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

Export a session as JSON from Langfuse:

1. Open your Langfuse project.
2. Find the failed `tester.loop` trace.
3. Click the **Export** button, or use the API.
4. Save it as a JSON file, for example `failed-session.json`.

The trace holds the full context: prompts, tool calls, page states, and AI decisions.

## Debugging with Claude Code

Explorbot includes a Claude Code skill that analyzes failed sessions.

### Using the Debug Skill

In Claude Code, run:

```
/explorbot-debug
```

The skill will ask for:
1. **Langfuse JSON export** — path to your exported trace file
2. **Or nothing** — it will analyze `output/explorbot.log` instead

### What the Skill Analyzes

The skill looks for three failure patterns:

| Pattern | Symptoms | Solution |
|---------|----------|----------|
| **Missing Context** | Wrong element clicked, didn't understand UI | Add Knowledge file with disambiguation rules |
| **Wrong Prompts** | Incorrect assumptions, wrong flow | Add Knowledge with business context |
| **Wrong Tool Choice** | Used click when form needed, typing issues | Add Knowledge with CodeceptJS code examples |

### How It Helps

1. Extracts key data from the trace with jq:
   - Failed tool calls
   - URLs visited
   - Prompts sent to the AI

2. Identifies the root cause of failures.

3. Suggests Knowledge files to fix the issue:
   ```markdown
   ---
   url: /admin/users/*
   ---

   ## User Table
   Each row has same buttons. Use container:
   I.click('Delete', '[data-user-id="123"]')
   ```

4. Can try interactions with browser tools, if available, and record working CodeceptJS code.

### Why Langfuse Matters for Debugging

Without Langfuse, you only see:

- The final test result (pass or fail).
- Basic logs.

With Langfuse traces, you see:

- The exact prompts the AI received at each step.
- The page state the AI analyzed.
- Which tool calls succeeded or failed, and why.
- Token usage and timing.
- The full decision chain.

That makes AI behavior debuggable. You can trace where and why it went wrong.

### Example Workflow

```bash
# 1. Test fails
./bin/explorbot-cli.ts explore --from /admin/users

# 2. Open Langfuse, find tester.loop trace, export JSON
# Save to: ./traces/failed-users-test.json

# 3. In Claude Code:
/explorbot-debug
# Provide path: ./traces/failed-users-test.json

# 4. Skill analyzes and suggests Knowledge fix
# 5. Create knowledge file
./bin/explorbot-cli.ts know "/admin/users/*" "Use container context for table actions"

# 6. Re-run test
```

## Debugging Tips

### Enable Verbose Logging

```bash
./bin/explorbot-cli.ts explore --verbose
```

Or set the environment variable:

```bash
DEBUG=explorbot:* ./bin/explorbot-cli.ts explore
```

This shows detailed logs:

- Prompts sent to the AI
- Tool calls and results
- State transitions

### Specific Debug Namespaces

```bash
# AI provider calls only
DEBUG=explorbot:provider ./bin/explorbot-cli.ts explore

# Navigator agent only
DEBUG=explorbot:navigator ./bin/explorbot-cli.ts explore

# Multiple namespaces
DEBUG=explorbot:tester,explorbot:navigator ./bin/explorbot-cli.ts explore
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

Langfuse tracks token usage per call. Use it to:

- Monitor cost across sessions
- Compare model efficiency
- Find expensive operations
- Tune prompts to reduce tokens

## Self-Hosting Langfuse

For privacy or compliance, [self-host Langfuse](https://langfuse.com/docs/deployment/self-host):

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
