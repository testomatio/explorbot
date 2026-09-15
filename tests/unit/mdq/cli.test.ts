import { describe, expect, it } from 'vitest';
import { runMdq } from '../../../src/utils/mdq/cli.ts';

const doc = `# Title

## API

| Method | Path |
|--------|------|
| GET | /users |

## FAQ

question?
`;

describe('reads', () => {
  it('prints matched markdown', async () => {
    const result = await runMdq(['h2'], doc);
    expect(result.output).toContain('## API');
    expect(result.code).toBe(0);
  });

  it('accepts a leading dot like jq', async () => {
    expect((await runMdq(['.h2'], doc)).output).toContain('## API');
  });

  it('prints rows as json', async () => {
    const result = await runMdq(['section("API") table', '--json'], doc);
    expect(JSON.parse(result.output)).toEqual([{ Method: 'GET', Path: '/users' }]);
  });

  it('prints a count', async () => {
    expect((await runMdq(['h2', '--count'], doc)).output.trim()).toBe('2');
  });

  it('prints unwrapped text', async () => {
    expect((await runMdq(['h2', '--text'], doc)).output).not.toContain('##');
  });

  it('prints frontmatter as json', async () => {
    const result = await runMdq(['--frontmatter'], '---\nurl: /x\n---\n\n# T\n');
    expect(JSON.parse(result.output)).toEqual({ url: '/x' });
  });
});

describe('edits', () => {
  it('removes and prints the whole document', async () => {
    const result = await runMdq(['section("FAQ")', '--remove'], doc);
    expect(result.output).not.toContain('## FAQ');
    expect(result.output).toContain('## API');
  });

  it('appends into a section', async () => {
    expect((await runMdq(['section("FAQ")', '--append', 'answer!'], doc)).output).toContain('answer!');
  });

  it('adds a table row from json', async () => {
    expect((await runMdq(['table', '--add-row', '{"Method":"POST","Path":"/s"}'], doc)).output).toContain('POST');
  });

  it('sets an entry', async () => {
    const result = await runMdq(['blockquote', '--set', 'Container=.x'], '> Container: .old\n');
    expect(result.output).toContain('.x');
    expect(result.output).not.toContain('.old');
  });

  it('refuses more than one edit at a time', async () => {
    const result = await runMdq(['h2', '--remove', '--append', 'x'], doc);
    expect(result.code).toBe(2);
    expect(result.output).toContain('Only one edit');
  });
});

describe('exit codes', () => {
  it('returns 1 when nothing matches', async () => {
    expect((await runMdq(['h5'], doc)).code).toBe(1);
  });

  it('returns 2 on an unknown selector', async () => {
    const result = await runMdq(['secton("A")'], doc);
    expect(result.code).toBe(2);
    expect(result.output).toContain('Unknown selector');
  });

  it('returns 1 when an edit matched nothing, leaving the document intact', async () => {
    const result = await runMdq(['h5', '--remove'], doc);
    expect(result.code).toBe(1);
    expect(result.output).toBe(doc);
  });

  it('returns 0 when an edit matched', async () => {
    expect((await runMdq(['h2', '--remove'], doc)).code).toBe(0);
  });

  it('returns 2 without a selector', async () => {
    expect((await runMdq([], doc)).code).toBe(2);
  });
});
