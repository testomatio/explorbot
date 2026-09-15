import { describe, expect, it } from 'bun:test';
import dedent from 'dedent';
import { extractCodeBlocks } from '../../src/utils/code-extractor.ts';

describe('extractCodeBlocks', () => {
  it('extracts a js block', () => {
    const response = dedent`
      \`\`\`js
      I.see('Widget', '.list')
      \`\`\`
    `;

    expect(extractCodeBlocks(response)).toEqual(["I.see('Widget', '.list')"]);
  });

  it('extracts an unlabelled block', () => {
    const response = dedent`
      \`\`\`
      I.see('Widget', '.list')
      \`\`\`
    `;

    expect(extractCodeBlocks(response)).toEqual(["I.see('Widget', '.list')"]);
  });

  it('keeps js blocks that follow a block in another language', () => {
    const response = dedent`
      The element is rendered as:

      \`\`\`html
      <a class="node-link"><span>Widget</span><small>0 tests</small></a>
      \`\`\`

      ### 1. Verify by visible text
      \`\`\`js
      I.see('Widget 0 tests', '.list')
      \`\`\`

      ### 2. Verify by selector
      \`\`\`js
      I.seeElement('.list a[href*="widget"]')
      \`\`\`
    `;

    expect(extractCodeBlocks(response)).toEqual(["I.see('Widget 0 tests', '.list')", 'I.seeElement(\'.list a[href*="widget"]\')']);
  });

  it('skips a block in another language even when its content parses as javascript', () => {
    const response = dedent`
      \`\`\`text
      Saved
      \`\`\`
    `;

    expect(extractCodeBlocks(response)).toEqual([]);
  });

  it('skips a js block that is not valid javascript', () => {
    const response = dedent`
      \`\`\`js
      I.see('Widget'
      \`\`\`
    `;

    expect(extractCodeBlocks(response)).toEqual([]);
  });
});
