import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createOpenAI } from '@ai-sdk/openai';
import { LLMock } from '@copilotkit/aimock';
import matter from 'gray-matter';
import { Provider } from '../../src/ai/provider.ts';
import { Scout } from '../../src/ai/scout.ts';
import { loadScoutCorpus } from '../../src/ai/scout/tools.ts';
import { ConfigParser } from '../../src/config.ts';

function toolCall(id: string, name: string, args: Record<string, any>) {
  return { id, name, arguments: JSON.stringify(args) };
}

function extractPromptText(entry: any): string {
  if (!entry?.body?.messages) return '';
  return entry.body.messages
    .map((message: any) => {
      if (typeof message.content === 'string') return message.content;
      if (Array.isArray(message.content)) {
        return message.content
          .filter((part: any) => part.type === 'text')
          .map((part: any) => part.text || '')
          .join('\n');
      }
      return '';
    })
    .join('\n');
}

describe('Scout with aimock', () => {
  let mock: LLMock;
  let provider: Provider;
  let corpusDir: string;

  beforeAll(async () => {
    mock = new LLMock({ port: 0, logLevel: 'silent' });
    await mock.start();

    const openai = createOpenAI({ baseURL: `${mock.url}/v1`, apiKey: 'test-key', compatibility: 'compatible' });
    ConfigParser.resetForTesting();
    ConfigParser.setupTestConfig();
    provider = new Provider({ model: openai.chat('test-model'), config: {} });
  });

  beforeEach(() => {
    mock.clearRequests();
    mock.resetMatchCounts();
    mock.clearFixtures();

    corpusDir = mkdtempSync(path.join(tmpdir(), 'scout-corpus-'));
    writePage('invite.md', '/invite', 'User can invite teammates');
    writePage('settings.md', '/settings', 'User can change workspace settings');
    writeFileSync(path.join(corpusDir, 'notes.md'), '# Notes\nhand-written quality notes without a page URL');
  });

  afterEach(() => {
    rmSync(corpusDir, { recursive: true, force: true });
  });

  afterAll(async () => {
    await mock.stop();
    ConfigParser.cleanupAllTestDirectories();
  });

  it('searches, reads and reports documented capabilities', async () => {
    mock.on({ sequenceIndex: 0 }, { toolCalls: [toolCall('s1', 'searchDocs', { query: 'invite' })] });
    mock.on({ sequenceIndex: 1 }, { toolCalls: [toolCall('r1', 'readDoc', { path: path.join(corpusDir, 'invite.md') })] });
    mock.on({ sequenceIndex: 2 }, { toolCalls: [toolCall('p1', 'report', { findings: '- /invite: user can invite teammates' })] });
    mock.on({}, { content: 'done' });

    const scout = new Scout(provider, loadScoutCorpus([corpusDir]));
    const result = await scout.collectDocs({ url: '/invite', title: 'Invites', feature: 'invitations', excludeUrls: [] });

    expect(result).toBe('- /invite: user can invite teammates');

    const systemPrompt = extractPromptText(mock.getRequests()[0]);
    expect(systemPrompt).toContain('documentation retrieval agent');
    expect(systemPrompt).toContain('/invite');
    expect(systemPrompt).toContain('/settings');
    expect(systemPrompt).toContain('no page URL');
    expect(systemPrompt).toContain('HAND-WRITTEN NOTES');
    expect(systemPrompt).toContain('hand-written quality notes');
    expect(extractPromptText(mock.getRequests()[0])).toContain('Focus: invitations');

    const offeredTools = JSON.stringify(mock.getRequests()[0]?.body?.tools);
    expect(offeredTools).toContain('searchDocs');
    expect(offeredTools).toContain('readDoc');
    expect(offeredTools).toContain('report');
    expect(offeredTools).not.toContain('readFile');
    expect(offeredTools).not.toContain('bash');
  });

  it('returns an empty string without any AI call when the corpus is empty', async () => {
    const scout = new Scout(provider, loadScoutCorpus([path.join(corpusDir, 'missing')]));

    const result = await scout.collectDocs({ url: '/invite', excludeUrls: [] });

    expect(result).toBe('');
    expect(mock.getRequests()).toHaveLength(0);
  });

  it('refuses to read a page excluded because it is already injected', async () => {
    mock.on({ sequenceIndex: 0 }, { toolCalls: [toolCall('r1', 'readDoc', { path: path.join(corpusDir, 'invite.md') })] });
    mock.on({ sequenceIndex: 1 }, { toolCalls: [toolCall('s1', 'searchDocs', { query: 'invite' })] });
    mock.on({ sequenceIndex: 2 }, { toolCalls: [toolCall('p1', 'report', { findings: '- /settings: documented settings' })] });
    mock.on({}, { content: 'done' });

    const scout = new Scout(provider, loadScoutCorpus([corpusDir]));
    const result = await scout.collectDocs({ url: '/invite', excludeUrls: ['/invite'] });

    expect(result).toBe('- /settings: documented settings');
    expect(JSON.stringify(mock.getRequests())).toContain('already provided to the planner');
  });

  it('treats a no-tool-call response after searching as the report', async () => {
    mock.on({ sequenceIndex: 0 }, { toolCalls: [toolCall('s1', 'searchDocs', { query: 'invite' })] });
    mock.on({}, { content: 'No relevant documentation exists' });

    const scout = new Scout(provider, loadScoutCorpus([corpusDir]));

    const result = await scout.collectDocs({ url: '/invite', excludeUrls: [] });

    expect(result).toBe('No relevant documentation exists');
  });

  it('discards an answer that searched or read nothing', async () => {
    mock.on({}, { content: 'The documentation describes invites and settings' });

    const scout = new Scout(provider, loadScoutCorpus([corpusDir]));

    const result = await scout.collectDocs({ url: '/invite', excludeUrls: [] });

    expect(result).toBe('');
  });

  it('reuses a cached answer for the same page and focus', async () => {
    mock.on({ sequenceIndex: 0 }, { toolCalls: [toolCall('s1', 'searchDocs', { query: 'invite' })] });
    mock.on({ sequenceIndex: 1 }, { toolCalls: [toolCall('p1', 'report', { findings: '- /invite: cached findings' })] });
    mock.on({}, { content: 'done' });

    const scout = new Scout(provider, loadScoutCorpus([corpusDir]));
    const first = await scout.collectDocs({ url: '/invite', feature: 'invitations', excludeUrls: [] });
    const requestsAfterFirst = mock.getRequests().length;

    const second = await scout.collectDocs({ url: '/invite', feature: 'invitations', excludeUrls: [] });

    expect(first).toBe('- /invite: cached findings');
    expect(second).toBe(first);
    expect(mock.getRequests().length).toBe(requestsAfterFirst);
  });

  function writePage(filename: string, url: string, body: string): void {
    writeFileSync(path.join(corpusDir, filename), matter.stringify(`# ${url}\n\n## Purpose\n\n${body}\n`, { url, format: 'explorbot-application-spec', version: 1 }), 'utf8');
  }
});
