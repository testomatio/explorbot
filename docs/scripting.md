# Building Custom Scripts

Explorbot can be used programmatically to build autonomous testing pipelines. This guide shows how to create scripts that run without the TUI.

## Basic Setup

```typescript
import { ExplorBot } from 'explorbot';

const bot = new ExplorBot({
  path: '.',              // Path to explorbot.config.js
  from: '/dashboard',     // Starting URL
  verbose: true,          // Enable debug logging
  show: true,             // Show browser window (false for headless)
  incognito: true,        // Don't save/load experience files
});

await bot.start();
// ... do stuff ...
await bot.stop();
```

### Options

| Option | Type | Description |
|--------|------|-------------|
| `path` | string | Path to directory containing `explorbot.config.js` |
| `from` | string | Starting URL path (e.g., `/login`, `/dashboard`) |
| `verbose` | boolean | Enable debug logging |
| `show` | boolean | Show browser window (default: false) |
| `headless` | boolean | Run in headless mode |
| `incognito` | boolean | Don't persist experience files |

## Navigation

```typescript
// Visit a page
await bot.visit('/settings');

// Get current page state
const state = bot.getCurrentState();
console.log(state.url);
console.log(state.title);
```

## Research

Analyze a page to understand its UI:

```typescript
const state = bot.getCurrentState();
const research = await bot.agentResearcher().research(state);

console.log(research);
// Contains: interactive elements, forms, navigation, etc.
```

Research with options:

```typescript
await bot.agentResearcher().research(state, {
  screenshot: true,    // Capture screenshot for vision analysis
  force: true,         // Re-research even if cached
  data: true,          // Extract structured data (tables, lists)
});
```

## Planning

Generate test scenarios automatically:

```typescript
// Plan tests for current page
const plan = await bot.agentPlanner().plan();

console.log(plan.title);
console.log(plan.tests.map(t => t.scenario));
// ["Verify login with valid credentials", "Test password validation", ...]
```

Plan with focus:

```typescript
// Focus on specific feature
const plan = await bot.agentPlanner().plan('checkout flow');
```

## Creating Tests Manually

Define your own test scenarios:

```typescript
import { Plan, Test } from 'explorbot';

const plan = new Plan('User Authentication');
plan.url = '/login';

const test = new Test(
  'Verify login with valid credentials',  // Scenario name
  'high',                                   // Priority: high, medium, low
  [                                         // Expected outcomes
    'Username field accepts input',
    'Password field accepts input',
    'Login button submits form',
    'User is redirected to dashboard',
  ],
  '/login'                                  // Starting URL
);

plan.addTest(test);
```

## Running Tests

Execute tests using the Tester agent:

```typescript
const tester = bot.agentTester();

// Run a single test
await tester.test(test);

// Check results
console.log(test.isSuccessful);  // true/false
console.log(test.hasFailed);     // true/false
console.log(test.getPrintableNotes());
```

Run all tests in a plan:

```typescript
for (const test of plan.tests) {
  await tester.test(test);

  console.log(`${test.scenario}: ${test.isSuccessful ? 'PASSED' : 'FAILED'}`);
  test.getPrintableNotes().forEach(note => console.log(`  ${note}`));
}
```

## Full Exploration Cycle

Run research → plan → test automatically:

```typescript
// This does research, planning, and testing in one call
await bot.explore();

// Or with feature focus
await bot.explore('user settings');
```

## Accessing Results

```typescript
// Get the current plan
const plan = bot.getCurrentPlan();

// Check completion
console.log(plan.isComplete);     // All tests finished
console.log(plan.allSuccessful);  // All tests passed
console.log(plan.allFailed);      // All tests failed

// Get pending tests
const pending = plan.getPendingTests();

// Iterate results
for (const test of plan.tests) {
  console.log({
    scenario: test.scenario,
    priority: test.priority,
    status: test.status,        // pending, in_progress, done
    result: test.result,        // passed, failed, null
    summary: test.summary,
    generatedCode: test.generatedCode,  // CodeceptJS code
  });
}
```

## Saving Plans

```typescript
// Save current plan to markdown
const path = bot.savePlan();
// Saved to: output/plans/user-authentication.md

// Save with custom filename
bot.savePlan('my-custom-plan.md');

// Load a saved plan
const loaded = bot.loadPlan('my-custom-plan.md');
```

## Complete Example

```typescript
#!/usr/bin/env bun

import { ExplorBot, Plan, Test } from 'explorbot';

async function runTests() {
  const bot = new ExplorBot({
    path: '.',
    from: '/login',
    show: process.env.SHOW === 'true',
  });

  await bot.start();

  // Navigate and research
  const state = bot.getCurrentState();
  await bot.agentResearcher().research(state);

  // Create a test plan
  const plan = new Plan('Login Flow');
  plan.url = '/login';

  plan.addTest(new Test(
    'Login with valid credentials',
    'high',
    ['User sees dashboard after login'],
    '/login'
  ));

  plan.addTest(new Test(
    'Login with invalid password',
    'medium',
    ['Error message is displayed'],
    '/login'
  ));

  // Run tests
  const tester = bot.agentTester();

  for (const test of plan.tests) {
    await tester.test(test);
  }

  // Report results
  const passed = plan.tests.filter(t => t.isSuccessful).length;
  const failed = plan.tests.filter(t => t.hasFailed).length;

  console.log(`\nResults: ${passed} passed, ${failed} failed`);

  for (const test of plan.tests) {
    const icon = test.isSuccessful ? '✓' : '✗';
    console.log(`${icon} ${test.scenario}`);
  }

  await bot.stop();

  // Exit with error code if any test failed
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
```

## Running in CI

```bash
# Run script
bun run ./scripts/my-tests.ts

# Show browser for debugging
SHOW=true bun run ./scripts/my-tests.ts
```

Example GitHub Actions workflow:

```yaml
- name: Run Explorbot tests
  env:
    GROQ_API_KEY: ${{ secrets.GROQ_API_KEY }}
  run: bun run ./scripts/smoke-tests.ts
```

## Tips

1. **Use `incognito: true`** for CI to ensure clean state
2. **Set `show: true`** during development to see what's happening
3. **Start small** — test one scenario before building full suites
4. **Save plans** — load them later to re-run the same tests
5. **Check `generatedCode`** — tests produce reusable CodeceptJS code

## FAQ

* **Can I run it in Cursor? or Claude Code?**
  No, Explorbot is a separate application designed for constant testing. Cursor, Codex, or Claude Code are irrelevant as they are coding agents.

* **Why do you hate Opus?**
  Opus is great for coding. Here we need a simplest model which can consume a lot of HTML tokens to find relevant ones. Leave more interesting tasks to Opus.

* **Is that expensive?**
  No, it's not. It would cost you ~$1 for hour of running if you use Groq Cloud with gpt-oss-20b.

* **Does Explorbot have MCP?**
  Not yet.

* **Can I build my own agents with it?**
  Yes, use the programmatic API for it.

* **Ok, but I can do same in Cursor and Playwright MCP!**
  Good luck running it on CI! I also assume you will need to jump to it every 10 seconds to see how it runs the browser.

* **Can this be implemented as a Skill?**
  No! We use a deterministic system for testing control. LLM takes interaction decisions but there is no "system prompt".
