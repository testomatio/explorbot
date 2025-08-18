import type { Provider } from './provider.js';
import type { ActionResult } from '../action-result.js';
import { tag } from '../utils/logger.js';

export class Researcher {
  private provider: Provider;

  constructor(provider: Provider) {
    this.provider = provider;
  }

  async research(actionResult: ActionResult): Promise<string> {
    const simplifiedHtml = await actionResult.simplifiedHtml();

    const prompt = this.buildResearchPrompt(actionResult, simplifiedHtml);

    tag('multiline').log('📡 Asking...', prompt);

    const response = await this.provider.chat([
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: prompt,
          },
          ...(actionResult.screenshot
            ? [
                {
                  type: 'image',
                  image: actionResult.screenshot,
                },
              ]
            : []),
        ],
      },
    ]);

    tag('multiline').log('📡 Response:', response.text);

    return response.text;
  }

  private buildResearchPrompt(
    actionResult: ActionResult,
    html: string
  ): string {
    return `Analyze this web page and provide a comprehensive research report.

URL: ${actionResult.url || 'Unknown'}
Title: ${actionResult.title || 'Unknown'}

HTML Content:
${html}

Please provide a structured analysis in markdown format with the following sections:

## Summary
Brief overview of the page purpose and main content

## Functional Areas

### Menus
- Menu name: CSS/XPath locator
- Example: "Main Navigation": "nav.main-menu" or "//nav[@class='main-menu']"

### Content
- Content area name: CSS/XPath locator
- Example: "Article Header": "h1.article-title" or "//h1[@class='article-title']"

### Buttons
- Button name: CSS/XPath locator
- Example: "Submit Button": "button[type='submit']" or "//button[@type='submit']"

### Forms
- Form name: CSS/XPath locator
- Example: "Login Form": "form#login" or "//form[@id='login']"

### Navigation
- Navigation element name: CSS/XPath locator
- Example: "Breadcrumb": "nav.breadcrumb" or "//nav[@class='breadcrumb']"

## Testing Suggestions
Sort by severity (critical first, then high, medium, low):

### Critical
- **Area**: Specific area to test
- **Description**: What should be tested
- **Rationale**: Why this area is important to test
- **Locator**: CSS/XPath selector for the element

### High
- **Area**: Specific area to test
- **Description**: What should be tested
- **Rationale**: Why this area is important to test
- **Locator**: CSS/XPath selector for the element

Focus on identifying:
1. Critical user flows and functionality
2. Interactive elements that could break
3. Content that affects user experience
4. Navigation and accessibility features
5. Data input and form validation areas

For each element you identify, provide a reliable CSS selector or XPath locator that can be used for automated testing.`;
  }
}
