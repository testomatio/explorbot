import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, rmSync, utimesSync } from 'node:fs';
import { createOpenAI } from '@ai-sdk/openai';
import { LLMock } from '@copilotkit/aimock';
import { ExperienceCompactor } from '../../src/ai/experience-compactor.ts';
import { Provider } from '../../src/ai/provider.ts';
import { ConfigParser } from '../../src/config.ts';
import { ExperienceTracker, RECENT_WINDOW_DAYS } from '../../src/experience-tracker.ts';

function extractPromptText(entry: any): string {
  if (!entry?.body?.messages) return '';
  return entry.body.messages
    .map((m: any) => {
      if (typeof m.content === 'string') return m.content;
      if (Array.isArray(m.content)) {
        return m.content
          .filter((p: any) => p.type === 'text')
          .map((p: any) => p.text || '')
          .join('\n');
      }
      return '';
    })
    .join('\n');
}

function markAsOld(filePath: string): void {
  const past = new Date(Date.now() - (RECENT_WINDOW_DAYS + 5) * 24 * 60 * 60 * 1000);
  utimesSync(filePath, past, past);
}

describe('ExperienceCompactor with aimock', () => {
  let mock: LLMock;
  let provider: Provider;
  let tracker: ExperienceTracker;
  let compactor: ExperienceCompactor;
  let experienceDir: string;

  beforeAll(async () => {
    mock = new LLMock({ port: 0, logLevel: 'silent' });
    await mock.start();

    const openai = createOpenAI({
      baseURL: `${mock.url}/v1`,
      apiKey: 'test-key',
      compatibility: 'compatible',
    });

    ConfigParser.setupTestConfig();
    (ConfigParser.getInstance().getConfig().ai as any).model = openai.chat('test-model');
    provider = new Provider(ConfigParser.getInstance().getConfig().ai);
  });

  beforeEach(() => {
    mock.clearRequests();
    mock.resetMatchCounts();
    mock.clearFixtures();

    tracker = new ExperienceTracker();
    experienceDir = (tracker as any).experienceDir as string;
    if (existsSync(experienceDir)) {
      rmSync(experienceDir, { recursive: true, force: true });
    }
    (tracker as any).ensureDirectory(experienceDir);
    compactor = new ExperienceCompactor(provider, tracker);
  });

  afterAll(async () => {
    await mock.stop();
    if (existsSync(experienceDir)) {
      rmSync(experienceDir, { recursive: true, force: true });
    }
  });

  describe('compactFiles — single file', () => {
    it('strips empty sections without calling AI for old short files', async () => {
      const hash = 'old-short';
      const content = ['## ACTION: empty', '', '', '## ACTION: click button', '```js', 'I.click("btn")', '```'].join('\n');
      tracker.writeExperienceFile(hash, content, { url: '/page', title: 'Page' });
      markAsOld(`${experienceDir}/${hash}.md`);

      const compacted = await compactor.compactFiles(tracker.getAllExperience());

      expect(compacted).toBe(1);
      expect(mock.getRequests().length).toBe(0);
      const after = tracker.readExperienceFile(hash).content;
      expect(after).not.toContain('## ACTION: empty');
      expect(after).toContain('## ACTION: click button');
    });

    it('sends compact prompt to AI when content exceeds 5000 chars', async () => {
      const hash = 'long-file';
      const longContent = `## FLOW: do something\n\n${'* step bullet text here\n'.repeat(400)}`;
      tracker.writeExperienceFile(hash, longContent, { url: '/long', title: 'Long' });
      markAsOld(`${experienceDir}/${hash}.md`);

      mock.on({}, { content: '## FLOW: do something\n\n* consolidated step\n\n```js\nI.click("x")\n```\n' });

      const compacted = await compactor.compactFiles(tracker.getAllExperience());

      expect(compacted).toBe(1);
      const reqs = mock.getRequests();
      expect(reqs.length).toBe(1);

      const prompt = extractPromptText(reqs[0]);
      expect(prompt).toContain('<context>');
      expect(prompt).toContain('## FLOW:');
      expect(prompt).toContain('Every section must be either a multi-step FLOW or a single-step ACTION');

      const after = tracker.readExperienceFile(hash).content;
      expect(after).toContain('consolidated step');
      expect(after.length).toBeLessThan(longContent.length);
    });

    it('preserves frontmatter when writing back compacted content', async () => {
      const hash = 'long-file-fm';
      const longContent = `## FLOW: do X\n\n${'* step text\n'.repeat(400)}`;
      tracker.writeExperienceFile(hash, longContent, {
        url: '/frontmatter-test',
        title: 'FM',
        related: ['/frontmatter-test/sub'],
      });
      markAsOld(`${experienceDir}/${hash}.md`);
      mock.on({}, { content: '## FLOW: do X\n\n```js\nI.click("x")\n```\n' });

      await compactor.compactFiles(tracker.getAllExperience());

      const { data } = tracker.readExperienceFile(hash);
      expect(data.url).toBe('/frontmatter-test');
      expect(data.title).toBe('FM');
      expect(data.related).toEqual(['/frontmatter-test/sub']);
    });

    it('returns 0 when file has no empty sections and no changes', async () => {
      const hash = 'stable';
      const content = '## ACTION: click submit\n\n```js\nI.click("Submit")\n```\n';
      tracker.writeExperienceFile(hash, content, { url: '/p', title: 'P' });
      markAsOld(`${experienceDir}/${hash}.md`);

      const compacted = await compactor.compactFiles(tracker.getAllExperience());

      expect(compacted).toBe(0);
      expect(mock.getRequests().length).toBe(0);
    });
  });

  describe('compactFiles — recent file AI review', () => {
    it('drops sections the AI marks keep=false for recent files', async () => {
      const hash = 'recent-1';
      const content = ['## ACTION: click submit', '```js', 'I.click("Submit")', '```', '', '## ACTION: click ember123', '```js', 'I.click("#ember123")', '```'].join('\n');
      tracker.writeExperienceFile(hash, content, { url: '/login', title: 'Login' });

      mock.on(
        {},
        {
          content: JSON.stringify({
            sections: [
              { index: 0, keep: true, reason: 'good' },
              { index: 1, keep: false, reason: 'dynamic ember id' },
            ],
          }),
        }
      );

      const compacted = await compactor.compactFiles(tracker.getAllExperience());

      expect(compacted).toBe(1);
      const after = tracker.readExperienceFile(hash).content;
      expect(after).toContain('## ACTION: click submit');
      expect(after).not.toContain('ember123');
    });

    it('sends URL, title, and sections to the review prompt', async () => {
      const hash = 'recent-2';
      const content = '## ACTION: click create\n\n```js\nI.click("Create")\n```\n';
      tracker.writeExperienceFile(hash, content, { url: '/projects', title: 'Projects' });

      mock.on({}, { content: JSON.stringify({ sections: [{ index: 0, keep: true, reason: 'ok' }] }) });

      await compactor.compactFiles(tracker.getAllExperience());

      const prompt = extractPromptText(mock.getLastRequest());
      expect(prompt).toContain('url: /projects');
      expect(prompt).toContain('title: Projects');
      expect(prompt).toContain('Section 0: ACTION: click create');
      expect(prompt).toContain('<drop_if>');
      expect(prompt).toContain('<keep_if>');
    });
  });

  describe('mergeSimilarExperiences', () => {
    it('merges files with a dynamic URL pattern and deletes sources', async () => {
      tracker.writeExperienceFile('item-1', '## ACTION: open item 1\n\n```js\nI.click("1")\n```\n', { url: '/item/1', title: 'Item 1' });
      tracker.writeExperienceFile('item-2', '## ACTION: open item 2\n\n```js\nI.click("2")\n```\n', { url: '/item/2', title: 'Item 2' });
      tracker.writeExperienceFile('item-3', '## ACTION: open item 3\n\n```js\nI.click("3")\n```\n', { url: '/item/3', title: 'Item 3' });

      mock.on(
        {},
        {
          content: JSON.stringify({
            mergeGroups: [{ urls: ['/item/1', '/item/2', '/item/3'], pattern: '~/item/\\d+~' }],
          }),
        }
      );

      const merged = await compactor.mergeSimilarExperiences();

      expect(merged).toBe(2);
      const all = tracker.getAllExperience();
      expect(all).toHaveLength(1);
      expect(all[0].data.url).toBe('~/item/\\d+~');
      expect(all[0].data.mergedFrom).toEqual(['/item/1', '/item/2', '/item/3']);
      expect(all[0].content).toContain('open item 1');
      expect(all[0].content).toContain('open item 2');
      expect(all[0].content).toContain('open item 3');
    });

    it('sends all candidate URLs to the merge prompt', async () => {
      tracker.writeExperienceFile('a', 'content A', { url: '/users/alice', title: 'Alice' });
      tracker.writeExperienceFile('b', 'content B', { url: '/users/bob', title: 'Bob' });
      tracker.writeExperienceFile('c', 'content C', { url: '/about', title: 'About' });

      mock.on({}, { content: JSON.stringify({ mergeGroups: [] }) });

      await compactor.mergeSimilarExperiences();

      const prompt = extractPromptText(mock.getLastRequest());
      expect(prompt).toContain('/users/alice');
      expect(prompt).toContain('/users/bob');
      expect(prompt).toContain('/about');
      expect(prompt).toContain('Example: /item/101, /item/102');
    });

    it('skips files that already have a regex URL pattern', async () => {
      tracker.writeExperienceFile('already-merged', 'prior', { url: '~/old/\\d+~', title: 'Already' });
      tracker.writeExperienceFile('fresh-1', 'content 1', { url: '/fresh/1', title: 'Fresh 1' });
      tracker.writeExperienceFile('fresh-2', 'content 2', { url: '/fresh/2', title: 'Fresh 2' });

      mock.on(
        {},
        {
          content: JSON.stringify({
            mergeGroups: [{ urls: ['/fresh/1', '/fresh/2'], pattern: '~/fresh/\\d+~' }],
          }),
        }
      );

      const merged = await compactor.mergeSimilarExperiences();

      expect(merged).toBe(1);
      const prompt = extractPromptText(mock.getLastRequest());
      expect(prompt).not.toContain('~/old/\\d+~');
      expect(prompt).toContain('/fresh/1');
    });

    it('returns 0 without calling AI when fewer than 2 files exist', async () => {
      tracker.writeExperienceFile('solo', 'content', { url: '/solo', title: 'Solo' });

      const merged = await compactor.mergeSimilarExperiences();

      expect(merged).toBe(0);
      expect(mock.getRequests().length).toBe(0);
    });

    it('returns 0 when AI proposes no merge groups', async () => {
      tracker.writeExperienceFile('p1', 'A', { url: '/a', title: 'A' });
      tracker.writeExperienceFile('p2', 'B', { url: '/b', title: 'B' });

      mock.on({}, { content: JSON.stringify({ mergeGroups: [] }) });

      const merged = await compactor.mergeSimilarExperiences();

      expect(merged).toBe(0);
      expect(tracker.getAllExperience()).toHaveLength(2);
    });
  });

  describe('compactAllExperiences', () => {
    it('runs merge first, then compacts remaining files', async () => {
      tracker.writeExperienceFile('post-1', '## ACTION: view post 1\n\n```js\nI.amOnPage("/post/1")\n```\n', { url: '/post/1', title: 'Post 1' });
      tracker.writeExperienceFile('post-2', '## ACTION: view post 2\n\n```js\nI.amOnPage("/post/2")\n```\n', { url: '/post/2', title: 'Post 2' });
      markAsOld(`${experienceDir}/post-1.md`);
      markAsOld(`${experienceDir}/post-2.md`);

      mock.on({ sequenceIndex: 0 }, { content: JSON.stringify({ mergeGroups: [{ urls: ['/post/1', '/post/2'], pattern: '~/post/\\d+~' }] }) });

      const result = await compactor.compactAllExperiences();

      expect(result.merged).toBe(1);
      expect(result.compacted).toBe(0);
      const all = tracker.getAllExperience();
      expect(all).toHaveLength(1);
      expect(all[0].data.url).toBe('~/post/\\d+~');
    });
  });

  describe('autocompact (startup fast path)', () => {
    it('makes zero AI calls when URLs are all static and all files are small', async () => {
      tracker.writeExperienceFile('about', '## ACTION: see about\n\n```js\nI.click("About")\n```\n', { url: '/about', title: 'About' });
      tracker.writeExperienceFile('contact', '## ACTION: see contact\n\n```js\nI.click("Contact")\n```\n', { url: '/contact', title: 'Contact' });
      tracker.writeExperienceFile('home', '## ACTION: go home\n\n```js\nI.click("Home")\n```\n', { url: '/home', title: 'Home' });

      const result = await compactor.autocompact();

      expect(result).toEqual({ merged: 0, compacted: 0 });
      expect(mock.getRequests().length).toBe(0);
    });

    it('sends only dynamic-URL candidates to the merge AI', async () => {
      tracker.writeExperienceFile('i1', 'short A', { url: '/item/101', title: 'Item 101' });
      tracker.writeExperienceFile('i2', 'short B', { url: '/item/102', title: 'Item 102' });
      tracker.writeExperienceFile('about', 'short C', { url: '/about', title: 'About' });

      mock.on({}, { content: JSON.stringify({ mergeGroups: [{ urls: ['/item/101', '/item/102'], pattern: '~/item/\\d+~' }] }) });

      await compactor.autocompact();

      const reqs = mock.getRequests();
      expect(reqs.length).toBe(1);
      const prompt = extractPromptText(reqs[0]);
      expect(prompt).toContain('/item/101');
      expect(prompt).toContain('/item/102');
      expect(prompt).not.toContain('/about');
    });

    it('respects dynamicPageRegex from config when selecting candidates', async () => {
      const config = ConfigParser.getInstance().getConfig();
      const original = config.dynamicPageRegex;
      config.dynamicPageRegex = '^custom-\\d+$';

      try {
        tracker.writeExperienceFile('c1', 'short 1', { url: '/page/custom-1', title: 'C1' });
        tracker.writeExperienceFile('c2', 'short 2', { url: '/page/custom-2', title: 'C2' });

        mock.on({}, { content: JSON.stringify({ mergeGroups: [{ urls: ['/page/custom-1', '/page/custom-2'], pattern: '~/page/custom-\\d+~' }] }) });

        await compactor.autocompact();

        expect(mock.getRequests().length).toBe(1);
        const prompt = extractPromptText(mock.getLastRequest());
        expect(prompt).toContain('/page/custom-1');
        expect(prompt).toContain('/page/custom-2');
      } finally {
        config.dynamicPageRegex = original;
      }
    });

    it('skips AI review and compact for small recent files', async () => {
      tracker.writeExperienceFile('small-recent', '## ACTION: click submit\n\n```js\nI.click("Submit")\n```\n', { url: '/form', title: 'Form' });

      const result = await compactor.autocompact();

      expect(result).toEqual({ merged: 0, compacted: 0 });
      expect(mock.getRequests().length).toBe(0);
    });

    it('compacts large files even in auto mode', async () => {
      const longContent = `## FLOW: do something\n\n${'* step bullet text here\n'.repeat(400)}`;
      tracker.writeExperienceFile('large', longContent, { url: '/big', title: 'Big' });
      markAsOld(`${experienceDir}/large.md`);

      mock.on({}, { content: '## FLOW: do something\n\n* consolidated\n\n```js\nI.click("x")\n```\n' });

      const result = await compactor.autocompact();

      expect(result.compacted).toBe(1);
      expect(mock.getRequests().length).toBe(1);
      const prompt = extractPromptText(mock.getLastRequest());
      expect(prompt).toContain('<context>');
    });

    it('generalizes a single dynamic URL to a regex pattern without AI', async () => {
      tracker.writeExperienceFile('u1', '## ACTION: view user\n\n```js\nI.click("user")\n```\n', { url: '/users/1', title: 'User 1' });

      const result = await compactor.autocompact();

      expect(result).toEqual({ merged: 1, compacted: 0 });
      expect(mock.getRequests().length).toBe(0);

      const all = tracker.getAllExperience();
      expect(all).toHaveLength(1);
      expect(all[0].data.url).toBe('~/users/\\d+~');
      expect(all[0].data.mergedFrom).toEqual(['/users/1']);
    });

    it('generalizes UUIDs and hex IDs', async () => {
      tracker.writeExperienceFile('u1', 'short', { url: '/items/550e8400-e29b-41d4-a716-446655440000', title: 'UUID item' });
      tracker.writeExperienceFile('u2', 'short', { url: '/suite/70dae98a', title: 'Hex suite' });

      mock.on({}, { content: JSON.stringify({ mergeGroups: [] }) });

      const result = await compactor.autocompact();

      expect(result.merged).toBe(2);

      const all = tracker.getAllExperience();
      const urls = all.map((f) => f.data.url).sort();
      expect(urls).toContain('~/items/[a-f0-9-]+~');
      expect(urls).toContain('~/suite/[a-f0-9]+~');
    });

    it('leaves static URLs untouched', async () => {
      tracker.writeExperienceFile('a', 'short', { url: '/about', title: 'About' });
      tracker.writeExperienceFile('h', 'short', { url: '/home', title: 'Home' });

      const result = await compactor.autocompact();

      expect(result).toEqual({ merged: 0, compacted: 0 });
      const all = tracker.getAllExperience();
      expect(all.map((f) => f.data.url).sort()).toEqual(['/about', '/home']);
    });
  });

  describe('stripNonUsefulEntries', () => {
    it('drops FLOW/ACTION sections with empty body', () => {
      const input = ['## ACTION: empty one', '', '', '## ACTION: keep this', '```js', 'I.click("x")', '```'].join('\n');

      const result = compactor.stripNonUsefulEntries(input);

      expect(result).not.toContain('empty one');
      expect(result).toContain('keep this');
    });

    it('keeps FLOW sections with bullet lists even without code', () => {
      const input = '## FLOW: a flow\n\n* first step\n* second step\n---\n';

      const result = compactor.stripNonUsefulEntries(input);

      expect(result).toContain('## FLOW: a flow');
    });

    it('drops ACTION sections whose code uses I.clickXY', () => {
      const input = ['## ACTION: visual click on button', '', '```js', 'I.clickXY(100, 200)', '```', '', '## ACTION: regular click', '', '```js', 'I.click("Submit")', '```'].join('\n');

      const result = compactor.stripNonUsefulEntries(input);

      expect(result).not.toContain('visual click on button');
      expect(result).not.toContain('I.clickXY');
      expect(result).toContain('## ACTION: regular click');
    });

    it('drops FLOW sections whose code uses I.clickXY', () => {
      const input = ['## FLOW: visual-based flow', '', '* Click somewhere', '```js', 'I.clickXY(50, 80)', '```', '---', '', '## FLOW: normal flow', '', '* Click button', '```js', 'I.click("Go")', '```', '---'].join('\n');

      const result = compactor.stripNonUsefulEntries(input);

      expect(result).not.toContain('visual-based flow');
      expect(result).not.toContain('I.clickXY');
      expect(result).toContain('## FLOW: normal flow');
    });
  });
});
