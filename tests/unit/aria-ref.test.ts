import { describe, expect, it } from 'bun:test';
import { parseAriaRefs } from '../../src/utils/aria-ref.ts';

describe('parseAriaRefs', () => {
  it('reads a genuine ariaRefSnapshot capture, including refs Playwright prefixes after a navigation', () => {
    const genuine = ['- generic [active] [ref=f1e1]:', '  - navigation [ref=f1e2]:', '    - link "Plans" [ref=f1e3] [cursor=pointer]:', '      - /url: /plans', '    - link "Suites" [ref=f1e4] [cursor=pointer]:', '  - button "New" [disabled] [ref=f1e5]', '  - checkbox [checked] [ref=f1e6]'].join(
      '\n'
    );

    const named = parseAriaRefs(genuine).filter((entry) => entry.name);

    expect(named.map((entry) => entry.ref)).toEqual(['f1e3', 'f1e4', 'f1e5']);
    expect(named[1]).toMatchObject({ role: 'link', name: 'Suites' });
  });
});
