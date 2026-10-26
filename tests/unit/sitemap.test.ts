import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractEntries, keepSiteUrls, readSitemap } from '../../src/utils/sitemap.ts';
import { UrlFilter } from '../../src/utils/url-filter.ts';

const dir = mkdtempSync(join(tmpdir(), 'sitemap-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function sitemapFile(name: string, content: string): string {
  const file = join(dir, name);
  writeFileSync(file, content);
  return file;
}

const urlset = sitemapFile(
  'urlset.xml',
  `<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/</loc><priority>1.0</priority><lastmod>2026-01-01</lastmod></url>
  <url><loc>https://example.com/admin/users</loc><priority>0.3</priority><lastmod>2026-05-01</lastmod></url>
  <url><loc>https://example.com/admin/logs</loc><lastmod>2026-03-01</lastmod></url>
  <url><loc>https://example.com/blog/post</loc><priority>0.8</priority></url>
</urlset>`
);

describe('sitemap', () => {
  test('extracts entries with entities and CDATA', () => {
    const entries = extractEntries('<urlset><url><loc> https://example.com/items?a=1&amp;b=2 </loc></url><url><loc><![CDATA[https://example.com/about]]></loc><priority>0.9</priority></url></urlset>');
    expect(entries.map((e) => e.url)).toEqual(['https://example.com/items?a=1&b=2', 'https://example.com/about']);
    expect(entries.map((e) => e.priority)).toEqual([0.5, 0.9]);
  });

  test('reads a plain text sitemap', () => {
    expect(extractEntries('https://example.com/a\n\n/b\nnot a url\n').map((e) => e.url)).toEqual(['https://example.com/a', '/b']);
  });

  test('follows a sitemap index to its child sitemaps', async () => {
    const child = sitemapFile('pages.xml', '<urlset><url><loc>https://example.com/one</loc></url><url><loc>https://example.com/one</loc></url></urlset>');
    const index = sitemapFile('index.xml', `<sitemapindex><sitemap><loc>${child}</loc></sitemap></sitemapindex>`);
    expect(await readSitemap(index)).toEqual(['https://example.com/one']);
  });

  test('keeps sitemap order without a query', async () => {
    expect(await readSitemap(urlset)).toEqual(['https://example.com/', 'https://example.com/admin/users', 'https://example.com/admin/logs', 'https://example.com/blog/post']);
  });

  test('filters, excludes, sorts and limits by URL filter', async () => {
    expect(await readSitemap(urlset, new UrlFilter('filter:/admin/*;exclude:/admin/logs'))).toEqual(['https://example.com/admin/users']);
    expect(await readSitemap(urlset, new UrlFilter('sort:priority;limit:2'))).toEqual(['https://example.com/', 'https://example.com/blog/post']);
    expect(await readSitemap(urlset, new UrlFilter('sort=lastmod'))).toEqual(['https://example.com/admin/users', 'https://example.com/admin/logs', 'https://example.com/', 'https://example.com/blog/post']);
  });

  test('drops URLs from other origins', () => {
    expect(keepSiteUrls(['https://example.com/a', 'https://other.com/b', '/c'], 'https://example.com')).toEqual(['https://example.com/a', '/c']);
  });
});
