# Explorbot - Claude Assistant Documentation

Explorbot is a Bun application that performs automated exploratory testing of web applications using AI. It combines intelligent web navigation with automatic failure recovery to test web applications without pre-written test scripts.

## Code Style

**Do not write comments unless explicilty specified**

Instead of if/else try to use premature exit from loop

Example:

```js
// bad example
if (!isValid()) {
   //...
} else {
  // ...
}

// good example
if (!isValid()) {
  // ...
  return;
}
```

When updating do the smallest change possible
Follow KISS and YAGNI principles
Avoid repetetive code patterns
Avoid creating extra functions that were not explicitly set

## Build

Run `npm run format` after each code change
After big changes run linter: `npm run lint:fix`
**Never use NodeJS**
This application is only Bun

## Core Architecture

Explorbot uses layered architecture with AI-driven automation:

1. **ExplorBot Class** (`src/explorbot.ts`) - Main application class handling TUI and user interaction
2. **Explorer Class** (`src/explorer.ts`) - Core orchestrator managing CodeceptJS integration and test execution
3. **Action Class** (`src/action.ts`) - Execution engine with AI-driven error resolution
4. **Navigator Class** (`src/ai/navigator.ts`) - AI-powered web interaction and problem solving
5. **Researcher Class** (`src/ai/researcher.ts`) - AI-powered web page analysis and understanding
6. **Planner Class** (`src/ai/planner.ts`) - AI-powered test scenario generation and prioritization
7. **StateManager Class** (`src/state-manager.ts`) - Web page state tracking and history management

## Application Usage

Application is built for explorarary automated testing using AI

Its capabilities:

- Open and navigate web pages intelligently
- Research page content and structure using AI to understand UI elements
- Plan comprehensive test scenarios with priority levels
- Execute tests with automatic failure recovery and self-healing
- Learn from successful and unsuccessful interactions via experience files
- Leverage domain knowledge from markdown documentation files
- Track application state and context-aware navigation history
- Support both interactive TUI mode and non-interactive automation

## TUI

Application is built via React Ink with interactive TUI

```
[
  <LogPane>
  (everything what is done by explorbot logs here)
]
[
  <ActivityPane> / <InputPane><AutocompletePane>

  when application performs action => ActivityPane is shown describing current actions
  when no action is performing, user input is shown
  provides auto completion when / or I is typed
]
[
  <StateTransitionPane>
  [prints which page we on right now]
]
```

### User Input in TUI

There are application commands available in TUI

* /research [uri] - performs research on a current page or navigate to [uri] if uri is provided
* /plan <feature> - plan testing feature starting from current page
* /navigate <uri_or_state> - move to other page. Use AI to complete navigation

There are also CodeceptJS commands availble:

* I.amOnPage() - navigate to expected page
* I.click() - click a link on this page
* I.see - ...
... etc (all codeceptjs commands)

## Command Line Usage

Explorbot uses the `maclay` CLI command (defined in `bin/maclay.ts`):

### Interactive exploration with TUI:
```bash
maclay explore
maclay explore --from https://example.com/login
maclay explore --path ./my-project
maclay explore --config ./custom-config.js
maclay explore --verbose  # or --debug
```

### Initialize project configuration:
```bash
maclay init
maclay init --config-path ./explorbot.config.js
maclay init --force  # overwrite existing config
```

### Add domain knowledge:
```bash
maclay add-knowledge  # or maclay knows
maclay add-knowledge --path ./knowledge
```

### Clean generated files:
```bash
maclay clean  # clean artifacts only
maclay clean --type experience
maclay clean --type all
```

Note: Non-interactive mode is planned but not yet implemented.

## Configuration

Explorbot uses `explorbot.config.js` or `explorbot.config.ts` for configuration.

Example configuration:
```javascript
export default {
  ai: {
    provider: 'openai', // or 'anthropic', 'groq'
    apiKey: process.env.AI_API_KEY
  },
  playwright: {
    browser: 'chromium', // or 'firefox', 'webkit'
    show: false,  // set to true to see browser window
    args: []      // additional browser arguments
  }
}
```

## Main Components

### Navigation (`src/ai/navigator.ts`)
AI-powered navigation that:
- Executes CodeceptJS commands with automatic error recovery
- Tries multiple element locator strategies
- Learns from failed attempts and applies solutions
- Uses experience files to optimize future interactions

### Research (`src/ai/researcher.ts`)
AI-powered page analysis that:
- Identifies all interactive UI elements
- Maps navigation structures and menus
- Expands collapsible content for full discovery
- Documents form fields and validation requirements
- Provides structured analysis for test planning

### Planning (`src/ai/planner.ts`)
AI-powered test generation that:
- Creates business-focused test scenarios
- Assigns priority levels (HIGH/MEDIUM/LOW)
- Generates expected outcomes for verification
- Balances positive and negative test cases
- Focuses on UI-testable functionality

### State Management (`src/state-manager.ts`)
Tracks navigation history and page context:
- Maintains current URL and page title
- Records navigation history
- Matches relevant knowledge/experience files
- Provides context for AI decision making

## Dependencies and Requirements

- **Runtime**: Bun only (Node.js is NOT supported)
- **AI Providers**: OpenAI, Anthropic, or Groq (configured via API key)
- **Browser Automation**: Playwright with CodeceptJS wrapper
- **TUI Framework**: React Ink for terminal interface

## Testing and Linting

```bash
npm run format       # Format code with Biome
npm run lint:fix     # Fix linting issues
npm run check:fix    # Run all Biome checks and fixes
```
