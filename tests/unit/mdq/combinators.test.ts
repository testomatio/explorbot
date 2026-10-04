import { describe, expect, it } from 'vitest';
import { MdqSelectorError, mdq, parseQuery } from '../../../src/utils/mdq/query.ts';

const doc = `# Guide

## API

| Method | Path |
|--------|------|
| GET | /users |

\`\`\`js
fetch('/users');
\`\`\`

## Install

\`\`\`bash
npm i
\`\`\`

## FAQ

- why OR how, though?

## Empty
`;

const plan = `<!-- suite -->
# Archive Vault Access

### Prerequisite

* URL: https://vault.example.com/vault

<!-- test
priority: critical
-->
# Unlock the vault

## Steps
* Enter the access code

## Expected
* Vault unlocked heading is visible
`;

const planChecks = 'comment(/^suite/) AND comment(/^test/) AND section("Prerequisite") item(/^URL: https:\\/\\/\\S+$/) AND section("Steps") AND section("Expected")';

describe('AND', () => {
  it('parses operands into one group', () => {
    const [group] = parseQuery('section("API") table AND code');
    expect(group).toHaveLength(2);
    expect(group[0].map((segment) => segment.selector)).toEqual(['section', 'table']);
    expect(group[1][0].selector).toBe('code');
  });

  it('matches when every operand matches', () => {
    expect(mdq(plan).query(planChecks).exists()).toBe(true);
  });

  it('matches nothing when one operand fails', () => {
    expect(mdq(plan.replace('## Expected', '## Outcome')).query(planChecks).exists()).toBe(false);
    expect(mdq(plan.replace('https://vault.example.com', '')).query(planChecks).exists()).toBe(false);
  });

  it('returns the matches of every operand in document order', () => {
    expect(
      mdq(doc)
        .query('h2("Install") AND h2("API")')
        .nodes()
        .map((node) => node.text)
    ).toEqual(['API', 'Install']);
  });
});

describe('OR', () => {
  it('parses each operand as its own group', () => {
    expect(parseQuery('table OR code')).toHaveLength(2);
  });

  it('matches when only one side exists', () => {
    expect(mdq(doc).query('h5 OR table').count()).toBe(1);
  });

  it('returns each node once when operands overlap', () => {
    expect(mdq(doc).query('code OR section("API") code').count()).toBe(2);
  });

  it('keeps a heading and its empty section as separate matches', () => {
    expect(mdq(doc).query('h2("Empty") OR section("Empty")').count()).toBe(2);
  });

  it('binds looser than AND', () => {
    expect(mdq(doc).query('h5 AND table OR code').count()).toBe(2);
    expect(mdq(doc).query('code OR h5 AND table').count()).toBe(2);
    expect(mdq(doc).query('h5 AND table OR h6').count()).toBe(0);
  });

  it('does not treat operator words inside a text matcher as operators', () => {
    expect(mdq(doc).query('item(~"why OR how") AND table').count()).toBe(2);
  });

  it('applies an index to its own operand', () => {
    expect(mdq(doc).query('h2[0] OR h2[-1]').count()).toBe(2);
  });

  it('applies a JavaScript matcher to every operand', () => {
    expect(
      mdq(doc)
        .query('h1 OR h2', /^(Guide|FAQ)$/)
        .count()
    ).toBe(2);
  });
});

describe('combinator errors', () => {
  it.each(['h2 AND', 'AND h2', 'h2 OR', 'h2 AND OR table', 'h2, table', 'h2 and table', 'h2:not(table)', 'h2)'])('rejects %s', (selector) => {
    expect(() => mdq(doc).query(selector)).toThrow(MdqSelectorError);
  });
});
