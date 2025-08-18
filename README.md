# Explorbot

A tool that integrates CodeceptJS with AI feedback loops for intelligent web automation.

## Features

- **CodeceptJS Integration**: Execute CodeceptJS code dynamically
- **AI Feedback Loop**: Get AI suggestions based on page state
- **HTML Processing**: Automatic HTML minification and processing
- **Screenshot Capture**: Get screenshots as buffers for AI context
- **Error Handling**: Comprehensive error handling and reporting
- **Proper Cleanup**: Automatic browser teardown and resource cleanup

## Installation

```bash
npm install
```

## Usage

### Basic Usage

```javascript
const Action = require('./src/action').default;
const Explorer = require('./src/explorer').default;

async function example() {
  const explorer = new Explorer();
  
  try {
    const I = await explorer.start();
    const action = explorer.startAction();

    const codeString = `
      await I.amOnPage('https://example.com');
      await I.click('#login-button');
      await I.fillField('#username', 'testuser');
    `;

    const result = await action.executeCodeceptCode(codeString);
    console.log('Minified HTML:', result.minifiedHtml);
    console.log('Screenshot:', result.screenshot);
  } finally {
    await explorer.teardown();
  }
}
```

### AI Feedback Loop

```javascript
const AIExplorer = require('./example_ai_feedback_loop').AIExplorer;

const explorer = new AIExplorer(actor);

const result = await explorer.executeWithAI(
  `await I.amOnPage('https://example.com');`,
  'Navigate to the homepage and find the login button'
);

console.log('AI Response:', result.aiResponse);
```

## API Reference

### Explorer Class

#### `start(configPath?: string): Promise<CodeceptJS.I>`

Initializes the browser and returns a CodeceptJS actor.

#### `teardown(): Promise<void>`

Properly shuts down the browser and cleans up resources. **Always call this when done!**

#### `stop(): Promise<void>`

Alternative method for stopping the browser (same as teardown).

### Action Class

#### `executeCodeceptCode(codeString: string): Promise<ActionResult>`

Executes CodeceptJS code and returns page state information.

**Parameters:**
- `codeString`: String containing CodeceptJS code to execute

**Returns:**
- `ActionResult` object containing:
  - `html`: Raw HTML of the page
  - `screenshot`: Screenshot as Buffer (or null if unavailable)
  - `minifiedHtml`: Processed and minified HTML
  - `error`: Error message if execution failed

### ActionResult Class

```typescript
class ActionResult {
  constructor(
    public readonly html: string,
    public readonly screenshot: Buffer | null,
    public readonly minifiedHtml: string,
    public readonly error: string | null = null
  ) {}
}
```

## Supported Helpers

The tool supports the following CodeceptJS helpers for screenshot capture:

- **Playwright**: Uses `page.screenshot()`
- **Puppeteer**: Uses `page.screenshot()`
- **WebDriver**: Uses `browser.saveScreenshot()`

## HTML Processing

The tool automatically processes HTML using CodeceptJS's built-in utilities:

1. **Non-interactive element removal**: Removes unnecessary elements to reduce context size
2. **HTML minification**: Compresses HTML for efficient AI processing
3. **Attribute filtering**: Keeps only relevant attributes for AI analysis

## Examples

See the following example files:

- `example_usage.js`: Basic usage example
- `example_ai_feedback_loop.js`: AI feedback loop implementation
- `example/run.ts`: Complete example with proper teardown

## Important: Resource Cleanup

**Always call `explorer.teardown()` when you're done!** This ensures:

- Browser processes are properly terminated
- No zombie processes are left running
- System resources are freed
- Clean exit from the application

```javascript
const explorer = new Explorer();

try {
  const I = await explorer.start();
  // ... your code here
} finally {
  await explorer.teardown(); // Always cleanup!
}
```

## Configuration

The tool uses CodeceptJS's default HTML processing options. You can customize these by modifying the `defaultHtmlOpts` in the HTML processing utilities.

## Error Handling

The tool provides comprehensive error handling:

- Execution errors are captured and returned in the `ActionResult`
- Screenshot failures are handled gracefully (returns null)
- HTML processing errors are logged but don't break execution
- Proper cleanup happens even on errors or interruptions

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License