# Explorbot

A CLI tool that integrates CodeceptJS with AI feedback loops for intelligent web automation. Built with React Ink for the CLI interface and uses Playwright for browser automation.

## Features

- **CLI Interface**: Interactive command-line interface built with React Ink
- **CodeceptJS Integration**: Execute CodeceptJS code dynamically with Playwright
- **AI Feedback Loop**: Get AI suggestions based on page state for error resolution
- **HTML Processing**: Automatic HTML minification and processing for AI context
- **Screenshot Capture**: Get screenshots as buffers for AI context
- **Error Handling**: Comprehensive error handling and AI-driven problem resolution
- **Proper Cleanup**: Automatic browser teardown and resource cleanup
- **Configuration Management**: Flexible configuration with validation and defaults

## Installation

```bash
npm install
```

## Usage

### CLI Usage

```bash
# Initialize configuration file
explorbot init

# Run with default config
explorbot

# Run with custom config path
explorbot --config ./my-config.js

# Run with verbose logging
explorbot --verbose
```

### Programmatic Usage

```typescript
import Explorer from './src/explorer.js';

async function example() {
  const explorer = new Explorer();
  
  try {
    const I = await explorer.start();
    const action = explorer.createAction();

    // Execute CodeceptJS code
    await action.execute("I.amOnPage('/projects/codeceptjs/')");
    
    // Set expectations
    await action.expect("I.seeInCurrentUrl('/projects/codeceptjs/')")
    
    // Use AI to resolve errors when condition is met
    await action.resolve(
      (result) => result.url?.includes('/login'),
      "Authorize using the credentials provided."
    );
  } finally {
    await explorer.stop();
  }
}
```

## Configuration

Create `explorbot.config.js` in your project root:

```javascript
export default {
  playwright: {
    url: "https://example.com",
    browser: "chromium",
    show: false
  },
  ai: {
    provider: "groq",
    model: "mixtral-8x7b-32768"
  },
  dirs: {
    knowledge: "knowledge",
    experience: "experience", 
    output: "output"
  }
};
```

### Required Configuration

- `playwright.url`: Target website URL
- `ai.provider`: AI provider (e.g., "groq")
- `ai.model`: AI model name

### Optional Configuration

- `playwright.browser`: Browser type (default: "chromium")
- `playwright.show`: Show browser window (default: false)
- `dirs.knowledge`: Knowledge directory (default: "knowledge")
- `dirs.experience`: Experience directory (default: "experience")
- `dirs.output`: Output directory (default: "output")

## API Reference

### Explorer Class

#### `start(configPath?: string): Promise<CodeceptJS.I>`

Initializes the browser, loads configuration, and returns a CodeceptJS actor.

#### `stop(): Promise<void>`

Properly shuts down the browser and cleans up resources. **Always call this when done!**

#### `createAction(): Action`

Creates an Action instance with the current actor and AI prompt vocabulary.

#### `getConfig(): ExplorbotConfig`

Returns the loaded configuration object.

#### `getAIProvider(): AIProvider`

Returns the AI provider instance.

### Action Class

#### `execute(codeString: string): Promise<Action>`

Executes CodeceptJS code and captures page state.

**Parameters:**
- `codeString`: String containing CodeceptJS code to execute

#### `expect(codeString: string): Promise<Action>`

Runs assertions and captures any failures.

#### `resolve(condition: (result: ActionResult) => boolean, message: string): Promise<Action>`

Uses AI to resolve errors when the condition is met.

**Parameters:**
- `condition`: Function that returns true when AI should intervene
- `message`: Instructions for the AI on how to resolve the issue

### ActionResult Class

```typescript
class ActionResult {
  public readonly html: string;
  public readonly screenshot: Buffer | null;
  public readonly title: string;
  public readonly url: string | null;
  public readonly error: string | null;
  public readonly timestamp: Date;
  
  async getSimplifiedHtml(): Promise<string>
  async simplify(): Promise<void>
  toAiContext(): string
  getStateHash(): string
}
```

## Directory Structure

```
project/
├── explorbot.config.js    # Configuration file
├── knowledge/            # Knowledge base prompts
├── experience/           # Experience prompts
├── output/              # Generated outputs
│   ├── logs/            # Execution logs
│   ├── reports/         # Test reports
│   ├── screenshots/     # Page screenshots
│   └── videos/          # Recorded sessions
└── src/                 # Your source code
```

## AI Integration

Explorbot uses AI to intelligently resolve errors during web automation:

1. **Error Detection**: When `expect()` fails, the error is captured
2. **Condition Check**: The `resolve()` method checks if intervention is needed
3. **AI Resolution**: If the condition is met, the current page state and error message are sent to AI
4. **Code Generation**: AI generates CodeceptJS code to resolve the issue
5. **Execution**: The generated code is executed automatically

## Examples

See the following example files:

- `example/run.ts`: Complete example with proper teardown
- `example/explorbot.config.js`: Example configuration
- `example/knowledge/`: Example knowledge base

## Build and Development

### Scripts

```bash
# Development
bun run dev

# Build for distribution
bun run build

# Run built version
bun run start

# Testing
bun run test

# Linting and formatting
bun run check
bun run lint
bun run format
```

### Tech Stack

- **CLI**: React Ink + yargs
- **Browser Automation**: CodeceptJS + Playwright
- **AI**: AI SDK with multiple provider support
- **Build**: Bun + TypeScript
- **Linting**: Biome

## Important: Resource Cleanup

**Always call `explorer.stop()`** for proper cleanup:

```typescript
const explorer = new Explorer();

try {
  const I = await explorer.start();
  // ... your code here
} finally {
  await explorer.stop(); // Always cleanup!
}
```

This ensures:
- Browser processes are properly terminated
- No zombie processes are left running
- System resources are freed
- Clean exit from the application

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License