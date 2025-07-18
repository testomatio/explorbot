# Explorbot - Claude Assistant Documentation

## Code Style

Do not write comments unless explicilty specified

Instead of if/else try to use premature exit from loop

When updating do the smallest change possible
Follow KISS and YAGNI principles
Avoid repetetive code patterns
Avoid creating extra functions that were not explicitly set

## Project Overview


Explorbot is a CLI tool that integrates CodeceptJS with AI feedback loops for intelligent web automation. It's built with React Ink for the CLI interface and uses Playwright for browser automation.

## Key Architecture Components

### Core Classes

#### Explorer (`src/explorer.ts`)
- **Main orchestrator class** that manages browser initialization, AI integration, and configuration
- **Key methods:**
  - `start(configPath?: string)`: Initializes container, starts browser, loads AI, returns CodeceptJS actor
  - `stop()`: Properly shuts down browser and cleans up resources
  - `createAction()`: Creates Action instance with actor and AI prompt vocabulary
  - `getConfig()`: Returns loaded configuration
  - `getAIProvider()`: Returns AI provider instance
- **Dependencies:** ConfigParser, AIProvider, PromptVocabulary, PromptParser
- **Location:** `src/explorer.ts:10-144`

#### Action (`src/action.ts`)
- **Main execution class** for CodeceptJS actions and AI-driven problem resolution
- **Key methods:**
  - `execute(codeString: string)`: Executes CodeceptJS code, captures page state
  - `expect(codeString: string)`: Runs assertions, captures failures
  - `resolve(condition, message)`: Uses AI to resolve errors when condition is met
  - `capturePageState()`: Gets URL, HTML, screenshot, title from current page
- **Features:** Error handling, state tracking, AI integration via PromptVocabulary
- **Location:** `src/action.ts:13-141`

#### ActionResult (`src/action-result.ts`)
- **Data structure** for page state information
- **Key methods:**
  - `getSimplifiedHtml()`: Returns minified, interactive-elements-only HTML
  - `simplify()`: Modifies HTML in-place to simplified version
  - `toAiContext()`: Formats data for AI consumption (excludes html, error, timestamp, screenshot)
  - `getStateHash()`: Creates unique hash from URL, headings, and error state
- **Location:** `src/action-result.ts:17-100`

#### ConfigParser (`src/config.ts`)
- **Singleton configuration manager** with validation and defaults
- **Key methods:**
  - `loadConfig(configPath?)`: Loads and validates configuration from file
  - `validateConfig()`: Ensures required fields are present
  - `mergeWithDefaults()`: Applies default values to partial config
- **Supported formats:** `.js`, `.mjs`, `.ts`, JSON
- **Location:** `src/config.ts:5-166`

### AI Integration

#### AIProvider (`src/ai/provider.ts`)
- Handles AI model initialization and communication
- Supports multiple AI providers (configured via `ai.provider` in config)

#### PromptVocabulary (`src/ai/prompt.ts`)
- Manages AI prompts and provides `resolveState()` method for error resolution
- Integrates with PromptParser for loading knowledge and experience

#### PromptParser (`src/prompt-parser.ts`)
- Loads prompts from knowledge and experience directories
- Supports markdown files with frontmatter

### CLI Interface

#### Main Entry (`src/index.tsx`)
- **CLI entry point** using React Ink and yargs
- **Commands:**
  - `explorbot init`: Initialize config file (via InitCommand)
  - `explorbot` (default): Launch main App component
- **Options:** `--config`, `--path`, `--verbose`
- **Location:** `src/index.tsx:1-64`

#### App Component (`src/components/App.tsx`)
- Main React Ink component for the CLI interface
- Manages Explorer lifecycle and user interaction

### Configuration

#### Config Structure (`explorbot.config.js`)
```javascript
{
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
}
```

#### Config File Resolution
1. `explorbot.config.js/ts` (root)
2. `config/explorbot.config.js/ts`
3. `src/config/explorbot.config.js/ts`

### Directory Structure

```
src/
├── index.tsx              # CLI entry point
├── explorer.ts            # Main Explorer class
├── action.ts              # Action execution and AI resolution
├── action-result.ts       # Page state data structure
├── config.ts              # Configuration management
├── prompt-parser.ts       # Prompt loading and parsing
├── ai/
│   ├── provider.ts        # AI provider abstraction
│   └── prompt.ts          # AI prompt vocabulary
├── commands/
│   └── InitCommand.ts     # Config initialization command
├── components/
│   ├── App.tsx            # Main CLI component
│   └── Welcome.tsx        # Welcome screen
└── utils/
    └── PromptParser.ts    # Prompt parsing utilities
```

## Usage Patterns

### Basic Usage (from `example/run.ts`)
```typescript
import Explorer from '../src/explorer.js';

const explorer = new Explorer();
const I = await explorer.start();
const action = explorer.createAction();

await action.execute("I.amOnPage('/projects/codeceptjs/')");
await action.expect("I.seeInCurrentUrl('/projects/codeceptjs/')")
await action.resolve(
  (result) => result.url?.includes('/login'),
  "Authorize using the credentials provided."
);

await explorer.stop();
```

### Error Resolution Pattern
The `action.resolve()` method is key - it:
1. Checks if condition is met based on current ActionResult
2. If true, sends current state + error message to AI
3. Executes AI-generated CodeceptJS code to resolve the issue

## Build and Development

### Scripts
- `bun run build`: Compile to `dist/` for distribution
- `bun run dev`: Run in development mode
- `bun run start`: Run built version
- `bun run test`: Run CodeceptJS tests
- `bun run check`: Run Biome linting and formatting

### Dependencies
- **Runtime:** React, Ink, CodeceptJS, Playwright, AI SDK
- **Build:** Bun, TypeScript, Biome (linting/formatting)

## Testing

Uses CodeceptJS for end-to-end testing with test files in `tests/` directory.

## Output Structure

```
output/
├── logs/           # Execution logs
├── reports/        # Test reports
├── screenshots/    # Page screenshots
└── videos/         # Recorded sessions
```

## Important Notes

1. **Always call `explorer.stop()`** for proper cleanup
2. **ActionResult.simplify()** is crucial for AI context - removes non-interactive elements
3. **State tracking** via Path class maintains execution history
4. **Error handling** is comprehensive with graceful degradation
5. **AI integration** requires proper configuration of provider and model