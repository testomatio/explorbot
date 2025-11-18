# Explorbot

Explorbot is an AI-powered terminal application for automated exploratory testing of web applications. It combines AI agents with browser automation to intelligently navigate, research, and test web interfaces without requiring pre-written test scripts.

## What Explorbot Does

Explorbot autonomously explores web applications by:

- **Navigating** web pages with AI-driven interaction and error recovery
- **Researching** page content to understand UI elements and functionality
- **Planning** test scenarios based on discovered features
- **Executing** tests with automatic failure resolution
- **Learning** from previous interactions through experience tracking
- **Leveraging** domain knowledge from documentation files

## Core Philosophy

This project has a hybrid agent-workflow implementation. 
While all core decisions (analyze page, run test, plan tests) are strictly implemented in code (workflow), when comes to tactical decisions (page navigation, test completentess) it is done in agentic mode. That makes Explorbot to be **deterministic in strategic goals**, while being flexible and smart in taking in-place decisions. This also reduces context length (each agent has few operations, so context overhead is not hit) and execution speed. 

Wherever possible Explorbot asks for codeblocks instead of executing tools directly. This way LLM provides few alternative suggestions to achieve the desired result in one request. Explorbot iterates over them with no additional AI calls. That saves tokens and speeds up navigation web page.


## Core Capabilities

### Intelligent Web Navigation
Explorbot can navigate complex web applications by understanding page context and user intent. It automatically resolves failed interactions by trying alternative approaches and learning from experience.

### Autonomous Page Research
The AI researcher analyzes web pages to identify:
- Interactive elements and their purposes
- Navigation paths and menu structures
- Form inputs and validation requirements
- Content areas and functional zones

### Dynamic Test Planning
Based on page research, Explorbot generates relevant test scenarios prioritized by:
- Critical business functionality (high priority)
- User experience features (medium priority)
- Edge cases and validations (low priority)

### Experience-Based Learning
Explorbot maintains experience files that capture:
- Successful interaction patterns
- Failed attempts and their solutions
- Page-specific knowledge and quirks
- Navigation patterns and shortcuts

## AI Agent Architecture

Explorbot uses a multi-agent system where each AI agent has a specific role in the exploratory testing process. The agents work together to provide comprehensive, intelligent web application testing.

### 🧭 Navigator Agent
The Navigator is the expert test automation engineer who handles all web interactions and error resolution:

- Executes browser automation commands (clicks, form fills, navigation)
- Analyzes page state after each action to verify success
- Resolves failed interactions using AI-powered problem solving
- Tries multiple element locator strategies when elements aren't found
- Learns from successful and failed interaction patterns through experience tracking
- Provides alternative approaches when primary interactions fail

### 🔍 Researcher Agent
The Researcher is the exploratory testing specialist who performs comprehensive page analysis:

- Identifies all interactive elements and their specific functions
- Maps navigation structures, menus, and hidden content areas
- Expands collapsible content (accordions, tabs, dropdowns) to discover full functionality
- Documents form fields, buttons, links, and content areas with detailed analysis
- Provides structured research summaries for test planning
- Caches research results to avoid redundant analysis
- Tracks page changes through HTML diffing

### 📋 Planner Agent

- Generates business-focused test scenarios based on research findings
- Assigns priority levels (HIGH/MEDIUM/LOW) based on risk and business importance
- Creates specific, verifiable expected outcomes for each scenario
- Balances positive scenarios (happy paths) with negative scenarios (edge cases)
- Ensures tests are atomic, independent, and relevant to the page content
- Focuses on main content areas rather than navigation elements
- Maintains test plan history to avoid duplicating previous scenarios

### 🧪 Tester Agent

- Executes planned test scenarios using CodeceptJS tools
- Interacts with web pages to achieve main scenario goals
- Verifies expected results as secondary objectives
- Handles test execution failures with adaptive problem solving
- Tracks state changes and page transitions during testing
- Documents test outcomes and any deviations from expected behavior
- Uses research data to understand page context during execution

### 🧑‍✈️ Captain Agent
The Captain is the orchestrator who coordinates all other agents and manages the overall testing session:

> WORK IN PROGRESS

- Listens to user input in TUI mode and reacts to user commands
- Can launch other agents
- Can change the current agent conversation
- Can update planning, test steps, etc

## Interactive Terminal Interface

Explorbot provides a real-time TUI (Terminal User Interface) with three main areas:

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ 📋 LOG PANE                                                                                         │
│                                                                                                     │
│ Expecting I.seeInCurrentUrl('/company/settings')                                                   │
│ Resolved I.seeInCurrentUrl('/company/settings')                                                    │
│ >  Added successful resolution to: users_sign_in.md                                                │
│ What should we do next? Consider /research, /plan, /navigate commands                              │
│ Researching...                                                                                      │
│ Initiated research for /company/settings to understand the context...                              │
│                                                                                                     │
│ ## Summary                                                                                          │
│ The Company Settings page lets users view and edit company details.                                │
│ The page provides navigation to other sections and user profile utilities.                         │
│                                                                                                     │
│ ## User Goals                                                                                       │
│ • Edit company name - Modify the "Company Name" field and save changes                            │
│ • Navigate settings - Switch between Company Settings, Share Options, AI tabs                      │
│                                                                                                     │
│ Planning...                                                                                         │
│   ⯈ AddScenario(Verify company name field is pre-populated, HIGH)                                  │
│   ⯈ AddScenario(Change company name and verify persistence, HIGH)                                   │
│   ⯈ AddScenario(Navigate away and return to verify name persists, HIGH)                            │
│ Done. Press [ESC] to enable input. Press [CTRL + t] to toggle session timer                                                                          │
└─────────────────────────────────────────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ > /plan user-management                                                                             │
└─────────────────────────────────────────────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────┐ ┌─────────────────────────────────────────┐
│ 🌐 STATE PANE                                           │ │ 📋 TASKS PANE                           │
│                                                         │ │                                         │
│ Current: /company/settings                              │ │ Testing Tasks            [3 total]     │
│ URL: https://app.example.com/company/settings           │ │                                         │
│ Title: Company Settings - Example App                   │ │ • Verify company name field is pre-po⭆ │
│ H2: Company Settings                                    │ │ • Change company name and verify per⭆  │
│                                                         │ │ • Navigate away and return to verify⭆  │
│ History: / → /login → /dashboard → /settings            │ │                                         │
└─────────────────────────────────────────────────────────┘ └─────────────────────────────────────────┘
```

**Log Pane**: Shows all Explorbot activities, AI decisions, research results, and execution logs

**Input Pane**: Single-line command input with autocomplete support for both application commands (/) and CodeceptJS commands (I.)

**State Pane**: Shows current page location, URL, title, and navigation history

**Tasks Pane**: Shows generated test scenarios with priorities and status

**Session Timer**: An optional timer displayed next to the activity line at the bottom of the TUI. It shows how much time has been spent in the current Explorbot session and can be toggled on and off with the `CTRL + t` key.

### Available Commands

**Application Commands:**
- `/research [url]` - Analyze current page or navigate to URL first
- `/plan [feature]` - Plan tests for a specific feature or general page testing
- `/navigate <target>` - AI-assisted navigation to pages or states
- `/test` - Test planned scenarios
- `/explore` - Research + plan + test

**CodeceptJS Commands:**
- `I.amOnPage(url)` - Navigate to a specific page
- `I.click(locator)` - Click elements on the page
- `I.fillField(locator, value)` - Fill form inputs
- All standard CodeceptJS commands are supported

### Keyboard Shortcuts
While using the TUI:
- `ESC` — enable the input line when Explorbot is waiting for commands
- `t` — toggle the session timer panel that shows elapsed time for the current session
- `Ctrl + C` — exit the current Explorbot session

## Command Line Usage

Explorbot provides several commands through the `maclay` CLI tool:

### Explore Command
Start interactive exploration with TUI interface:

```bash
# Basic exploration (opens interactive TUI)
maclay explore

# Start exploration from specific URL
maclay explore --from https://example.com/login

# Use custom configuration file
maclay explore --config ./custom-config.js

# Set working directory
maclay explore --path ./my-project

# Enable verbose logging
maclay explore --verbose
# or
maclay explore --debug
```

### Initialize Project
Set up Explorbot configuration in a new project:

```bash
# Create default config file
maclay init

# Custom config file location
maclay init --config-path ./config/explorbot.config.js

# Force overwrite existing config
maclay init --force

# Initialize in specific directory
maclay init --path ./my-project
```

### Add Knowledge
Add domain knowledge for specific URLs:

```bash
# Interactive knowledge addition
maclay add-knowledge
# or
maclay knows

# Use custom knowledge directory
maclay add-knowledge --path ./knowledge
```

### Clean Generated Files
Remove artifacts and experience files:

```bash
# Clean artifacts only (default)
maclay clean

# Clean specific type: artifacts, experience, or all
maclay clean --type experience
maclay clean --type all

# Clean custom directory
maclay clean --path ./custom-output
```

## Knowledge and Experience System

### Knowledge Files
Store domain-specific information about the application in `./knowledge/`:
- Business rules and workflows
- Known UI patterns and conventions
- Application-specific terminology
- Expected behaviors and edge cases

Example knowledge file:
```markdown
---
url: /users/sign_in
---

Login credentials for testing:
- email: test@example.com
- password: test123

Notes:
- Form validates email format before enabling submit button
- Password must be at least 8 characters
- Failed login shows error message above form
```

### Experience Files  
Automatically generated records of interactions in `./experience/`:
- Successful element location strategies
- Failed attempts and their resolutions
- Page-specific interaction patterns
- Error recovery solutions

Example experience file structure:
```markdown
---
url: /users/sign_in
title: Application Login
---

### Successful Attempt
Purpose: Login with provided credentials

```javascript
I.fillField('#content-desktop form#new_user input[name="user[email]"]', 'test@example.com');
I.fillField('#content-desktop form#new_user input[name="user[password]"]', 'test123');
I.click('#content-desktop form#new_user input[type="submit"][value="Sign In"]');
I.seeInCurrentUrl('/dashboard');
```

### Failed Attempts
- Text selectors failed on input fields (use specific CSS selectors instead)
- XPath absolute paths not supported by CodeceptJS
- Mobile containers not available in desktop view
- Submit button hidden until form validation passes
```

The system automatically matches relevant knowledge and experience files to current page context, providing AI agents with historical context for better decision-making.

## Getting Started with CLI

1. **Initialize your project**:
   ```bash
   maclay init
   ```

2. **Configure your AI provider** in `explorbot.config.js`:
   ```javascript
   export default {
     ai: {
       provider: 'openai', // or 'anthropic'
       apiKey: process.env.AI_API_KEY
     },
     playwright: {
       browser: 'chromium',
       show: false
     }
   }
   ```

3. **Add domain knowledge** (optional):
   ```bash
   maclay add-knowledge
   ```

4. **Start exploration**:
   ```bash
   maclay explore --from https://your-app.com
   ```

5. **Use interactive commands** in the TUI:
   - `/research` - Analyze current page
   - `/plan` - Generate test scenarios
   - `/navigate <target>` - AI-assisted navigation
   - `I.click()`, `I.fillField()` - Direct browser commands

## Example Workflow

```bash
# 1. Initialize project
maclay init

# 2. Add domain knowledge (optional)
maclay add-knowledge

# 3. Start exploration with verbose logging
maclay explore --from https://myapp.com/dashboard --verbose

# 4. In TUI, research the page
/research

# 5. Plan tests for specific feature
/plan user-management

# 6. Clean up when done
maclay clean --type all
```

## Configuration

Create `explorbot.config.js` or `explorbot.config.ts` in your project:

```typescript
export default {
  ai: {
    provider: 'openai', // or 'anthropic'
    apiKey: process.env.AI_API_KEY
  },
  playwright: {
    browser: 'chromium',
    show: false,
    args: []
  }
}
```

## Installation

```bash
bun install
```

## Requirements

- Bun runtime (Node.js is not supported)
- AI provider API key (OpenAI or Anthropic)
- Modern browser for Playwright automation

## Programmatic Usage

While Explorbot is primarily designed as a CLI tool, you can also use it programmatically in your own scripts:

```typescript
#!/usr/bin/env bun

import { ExplorBot } from './src/explorbot.js';
import { setPreserveConsoleLogs } from './src/utils/logger.js';
import dotenv from 'dotenv';

async function runAutomatedExploration() {
  dotenv.config();
  
  console.log('🚀 Starting automated exploration...');
  
  // Enable console logging preservation
  setPreserveConsoleLogs(true);

  // Initialize ExplorBot
  const explorBot = new ExplorBot({
    path: '.',
    verbose: true,
    from: '/'
  });

  await explorBot.loadConfig();
  console.log('✅ Config loaded successfully');

  await explorBot.start();
  console.log('✅ ExplorBot started successfully');

  // Visit initial page
  await explorBot.visitInitialState();
  console.log('✅ Visited initial page: /');

  // Navigate to specific page
  console.log('🧭 Navigating to target page...');
  const explorer = explorBot.getExplorer();
  await explorer.visit('/dashboard');

  // Research the page
  console.log('🔍 Starting research on the page...');
  await explorer.research();
  console.log('✅ Research completed');

  // Generate test plan
  const tasks = await explorer.plan();
  
  console.log('📋 Testing Plan');
  tasks.forEach((task) => {
    console.log(` • 🔳 ${task.scenario}`);
    console.log(`     Priority: ${task.priority}`);
    console.log(`     Expected Outcome: ${task.expectedOutcome}`);
  });

  // Clean up
  await explorer.stop();
  console.log('✅ ExplorBot stopped successfully');
}

if (import.meta.main) {
  runAutomatedExploration();
}
```

Run the script with:
```bash
bun run your-exploration-script.ts
```

This approach allows you to integrate Explorbot's capabilities into CI/CD pipelines, automated testing suites, or custom exploration workflows.

Explorbot learns as it goes, building up experience and knowledge to become more effective at testing your specific application over time.