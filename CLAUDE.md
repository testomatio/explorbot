# Explorbot - Claude Assistant Documentation

Explorbot is Bun application that performs automatical exploratary testing of web applications using AI.

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

1. **Explorer Class** - Main orchestrator and entry point
2. **Action Class** - Execution engine with AI-driven error resolution
3. **Navigator Class** - AI-powered web interaction and problem solving
4. **Researcher Class** - AI-powered web page analysis and test planning
5. **StateManager Class** - Web page state tracking and history management

## Application Usage

Application is built for explorarary automated testing using AI

Its capabilities:

- open web pages
- make a research of those pages using AI and researcher class
- plan testing of a page (using AI)
- perform a test using AI via tools and codeceptjs scripts
- learn from succesful and insuccesful interactions via experience files
- learn about application from knowledge files
- application tracks its state and understands where it is, and which knowledge or experience files are relevant based on state

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

By default explorbot should open a page and ask for you user input:

```
exporbot
```

Start explorbot at specific URL page

```
explorbot --from /admin/users
```

Read config from speficic dir or file

```
explorbot --path example
```

Research current page and ask for user input

```
explorbot --research
```

Open page, research it, plan testing of ir
If feature name is provided, focus testing on specific thing. 
Otherwise learn from page what is primary feature

```
explorbot --from /admin/users --plan [feature-name]
```

There should be non-interactive mode where user input is not availble. In this case appliation exits when finishing tasks.

## Configuration

`explorbot.config.js` or `explorbot.config.ts` is used.
See exportbot.config.ts or explorbot.config.js

## Main Logic

### Navigation

Using AI, experience, knowledge app can navigate to speific page

src/ai/navigator.ts

### Research 

Using Ai analyzes current page for its UI elements, especially interactive elements, to understand what navigation elements or paths are there

src/ai/researcher.ts

### Plan

Plan tests for a speficic feature starting from current page. 
Research is needed to start with

src/ai/researcher.ts
