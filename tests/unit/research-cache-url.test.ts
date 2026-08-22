import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { clearResearchCache, getCachedResearch, saveResearch } from '../../src/ai/researcher/cache.ts';
import { ConfigParser } from '../../src/config.ts';
import { outputPath } from '../../src/config.ts';
import { computeHtmlFingerprint } from '../../src/utils/html-diff.ts';
import { isSamePageFamily } from '../../src/utils/url-matcher.ts';

const html = '<html><body><button>Save</button><a href="/x">Plan row</a></body></html>';

describe('research cache url provenance', () => {
  beforeAll(() => {
    ConfigParser.setupTestConfig();
  });

  afterAll(() => {
    clearResearchCache();
    for (const hash of ['provenance-hash', 'plan-detail-hash', 'legacy-hash', 'a-wrong-page-hash', 'z-compatible-page-hash']) {
      rmSync(outputPath('research', `${hash}.md`), { force: true });
      rmSync(outputPath('states', `${hash}.fingerprint`), { force: true });
    }
  });

  it('keeps research unchanged and stores the url with its fingerprint', () => {
    saveResearch({ hash: 'provenance-hash', url: '/projects/p/plans' }, '## Plans List', html);

    const onDisk = readFileSync(outputPath('research', 'provenance-hash.md'), 'utf8');
    const fingerprint = JSON.parse(readFileSync(outputPath('states', 'provenance-hash.fingerprint'), 'utf8'));

    expect(onDisk).toBe('## Plans List');
    expect(fingerprint.url).toBe('/projects/p/plans');
    expect(fingerprint.entries.length).toBeGreaterThan(0);
    expect(getCachedResearch('provenance-hash')).toBe('## Plans List');
  });

  it('allows reuse between pages of the same family', () => {
    expect(isSamePageFamily('/projects/p/plans/aababeac', '/projects/p/plans/7a6c9c45')).toBe(true);
  });

  it('blocks reuse between different pages', () => {
    expect(isSamePageFamily('/projects/p/plans/7a6c9c45', '/projects/p/plans')).toBe(false);
    expect(isSamePageFamily('/projects/p/plans', '/projects/p/runs')).toBe(false);
  });

  it('findSimilarResearch rejects a fingerprint match recorded for a different page family', async () => {
    const detailHtml = '<html><body><section>Unique plan detail content</section><button>Delete plan</button></body></html>';
    saveResearch({ hash: 'plan-detail-hash', url: '/projects/p/plans/7a6c9c45' }, '## Plan Detail Research', detailHtml);
    const { findSimilarResearch } = await import('../../src/ai/researcher/cache.ts');

    const sameFamily = await findSimilarResearch(detailHtml, '/projects/p/plans/aababeac');
    expect(sameFamily).toBe('## Plan Detail Research');

    const differentPage = await findSimilarResearch(detailHtml, '/projects/p/plans');
    expect(differentPage).toBeNull();
  }, 20000);

  it('selects the best match from the requested page family', async () => {
    const matchingHtml = '<html><body><section>Unique matching content</section><button>Open item</button></body></html>';
    saveResearch({ hash: 'a-wrong-page-hash', url: '/projects/p/runs/7a6c9c45' }, '## Wrong Page', matchingHtml);
    saveResearch({ hash: 'z-compatible-page-hash', url: '/projects/p/plans/7a6c9c45' }, '## Compatible Page', matchingHtml);
    const { findSimilarResearch, findSimilarStateHash } = await import('../../src/ai/researcher/cache.ts');

    expect(await findSimilarResearch(matchingHtml, '/projects/p/plans/aababeac')).toBe('## Compatible Page');
    expect(await findSimilarStateHash(matchingHtml, '/projects/p/plans/aababeac')).toBe('z-compatible-page-hash');
  }, 20000);

  it('continues to read legacy line-based fingerprints', async () => {
    const legacyHtml = '<html><body><button>Legacy fingerprint</button></body></html>';
    saveResearch({ hash: 'legacy-hash' }, '## Legacy Research');
    writeFileSync(outputPath('states', 'legacy-hash.fingerprint'), computeHtmlFingerprint(legacyHtml).join('\n'));
    const { findSimilarResearch } = await import('../../src/ai/researcher/cache.ts');

    expect(await findSimilarResearch(legacyHtml, '/legacy')).toBe('## Legacy Research');
  }, 20000);
});
