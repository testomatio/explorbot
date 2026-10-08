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

- why || how, though?

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

const planChecks = 'comment(/^suite/) && comment(/^test/) && section("Prerequisite") item(/^URL: https:\\/\\/\\S+$/) && section("Steps") && section("Expected")';

describe('&&', () => {
  it('parses operands into one group', () => {
    const [group] = parseQuery('section("API") table && code');
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

  it('needs no spaces around the operator', () => {
    expect(mdq(doc).query('table&&code||h5').count()).toBe(3);
  });

  it('returns the matches of every operand in document order', () => {
    expect(
      mdq(doc)
        .query('h2("Install") && h2("API")')
        .nodes()
        .map((node) => node.text)
    ).toEqual(['API', 'Install']);
  });
});

describe('||', () => {
  it('parses each operand as its own group', () => {
    expect(parseQuery('table || code')).toHaveLength(2);
  });

  it('matches when only one side exists', () => {
    expect(mdq(doc).query('h5 || table').count()).toBe(1);
  });

  it('returns each node once when operands overlap', () => {
    expect(mdq(doc).query('code || section("API") code').count()).toBe(2);
  });

  it('keeps a heading and its empty section as separate matches', () => {
    expect(mdq(doc).query('h2("Empty") || section("Empty")').count()).toBe(2);
  });

  it('binds looser than &&', () => {
    expect(mdq(doc).query('h5 && table || code').count()).toBe(2);
    expect(mdq(doc).query('code || h5 && table').count()).toBe(2);
    expect(mdq(doc).query('h5 && table || h6').count()).toBe(0);
  });

  it('does not treat operator symbols inside a text matcher as operators', () => {
    expect(mdq(doc).query('item(~"why || how") && table').count()).toBe(2);
  });

  it('applies an index to its own operand', () => {
    expect(mdq(doc).query('h2[0] || h2[-1]').count()).toBe(2);
  });

  it('applies a JavaScript matcher to every operand', () => {
    expect(
      mdq(doc)
        .query('h1 || h2', /^(Guide|FAQ)$/)
        .count()
    ).toBe(2);
  });
});

describe('combinator errors', () => {
  it.each(['h2 &&', '&& h2', 'h2 ||', 'h2 && || table', 'h2 & table', 'h2 | table', 'h2 AND table', 'h2, table', 'h2)'])('rejects %s', (selector) => {
    expect(() => mdq(doc).query(selector)).toThrow(MdqSelectorError);
  });
});
