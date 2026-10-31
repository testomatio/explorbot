import dedent from 'dedent';
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';

if (!process.env.FORCE_COLOR) {
  process.env.FORCE_COLOR = '1';
}

marked.use(markedTerminal());
marked.setOptions({ breaks: true });

const renderer = (marked as any).defaults.renderer;
if (renderer) {
  if (renderer.text) {
    const originalText = renderer.text;
    renderer.text = function (text: any) {
      if (typeof text === 'object') {
        text = text.tokens ? this.parser.parseInline(text.tokens) : text.text;
      }
      return originalText.call(this, text);
    };
  }
  if (renderer.listitem) {
    const originalListitem = renderer.listitem;
    renderer.listitem = function (text: any) {
      if (typeof text === 'object') {
        const parser = this.parser;
        const originalParse = parser.parse.bind(parser);
        parser.parse = (tokens: any) => parser.parseInline(tokens);
        const result = originalListitem.call(this, text);
        parser.parse = originalParse;
        return result;
      }
      return originalListitem.call(this, text);
    };
  }
}

export function parseMarkdownToTerminal(markdown: string): string {
  const result = marked.parse(dedent(markdown)) as string;
  return result.replace(/^ {4}\*/gm, '*');
}
