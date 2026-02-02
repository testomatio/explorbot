import { describe, expect, test } from 'bun:test';
import { parseMarkdownToTerminal } from '../../src/utils/markdown-terminal.js';

describe('markdown-terminal', () => {
  test('should parse simple bold text', () => {
    const result = parseMarkdownToTerminal('**bold text**');
    expect(result).not.toContain('**');
    expect(result).toContain('bold text');
  });

  test('should parse bold text in list items', () => {
    const markdown = '* **bold text** - description';
    const result = parseMarkdownToTerminal(markdown);
    expect(result).not.toContain('**');
    expect(result).toContain('bold text');
  });

  test('should parse multiple list items with bold text', () => {
    const markdown = `Found 3 knowledge entries:

* **/projects/new-proj/settings/templates/** - There are various template types
* **/users/sign_in** - When asked for login use this credentials:
* **/projects/*** - ## EmberJS`;

    const result = parseMarkdownToTerminal(markdown);
    expect(result).not.toContain('**');
    expect(result).toContain('/projects/new-proj/settings/templates/');
    expect(result).toContain('/users/sign_in');
    expect(result).toContain('/projects/');
  });

  test('should handle dedent correctly', () => {
    const markdown = `
      * **item 1**
      * **item 2**
    `;
    const result = parseMarkdownToTerminal(markdown);
    expect(result).not.toContain('**');
    expect(result).toContain('item 1');
    expect(result).toContain('item 2');
  });

  test('should preserve non-bold text in list items', () => {
    const markdown = '* **bold** and normal text';
    const result = parseMarkdownToTerminal(markdown);
    expect(result).toContain('bold');
    expect(result).toContain('normal text');
    expect(result).not.toContain('**');
  });
});
