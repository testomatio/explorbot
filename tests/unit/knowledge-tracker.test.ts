import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, rmSync } from 'node:fs';
import { mkdirSync, writeFileSync } from 'node:fs';
import matter from 'gray-matter';
import { ConfigParser } from '../../src/config';
import { KnowledgeTracker } from '../../src/knowledge-tracker';

const knowledgeDir = '/tmp/explorbot-test-knowledge';

describe('KnowledgeTracker', () => {
  beforeEach(() => {
    if (existsSync(knowledgeDir)) {
      rmSync(knowledgeDir, { recursive: true, force: true });
    }
    mkdirSync(knowledgeDir, { recursive: true });

    const configParser = ConfigParser.getInstance();
    (configParser as any).config = {
      playwright: { browser: 'chromium', url: 'http://localhost:3000' },
      ai: { model: 'test' },
      dirs: { knowledge: 'explorbot-test-knowledge' },
    };
    (configParser as any).configPath = '/tmp/config.js';
  });

  afterEach(() => {
    if (existsSync(knowledgeDir)) {
      rmSync(knowledgeDir, { recursive: true, force: true });
    }
  });

  function writeKnowledgeFile(filename: string, url: string, content: string) {
    const fileContent = matter.stringify(content, { url });
    writeFileSync(`${knowledgeDir}/${filename}`, fileContent, 'utf8');
  }

  describe('interpolateVars', () => {
    it('should replace ${env.VAR} with environment variable value', () => {
      process.env.TEST_LOGIN = 'admin@example.com';
      process.env.TEST_PASSWORD = 'secret123';

      writeKnowledgeFile('login.md', '/login', 'email: ${env.TEST_LOGIN}\npassword: ${env.TEST_PASSWORD}');

      const tracker = new KnowledgeTracker();
      const content = tracker.getKnowledgeForUrl('/login');

      expect(content[0]).toContain('email: admin@example.com');
      expect(content[0]).toContain('password: secret123');

      process.env.TEST_LOGIN = undefined;
      process.env.TEST_PASSWORD = undefined;
    });

    it('should replace missing env vars with empty string', () => {
      process.env.NONEXISTENT_VAR = undefined;

      writeKnowledgeFile('login.md', '/login', 'token: ${env.NONEXISTENT_VAR}');

      const tracker = new KnowledgeTracker();
      const content = tracker.getKnowledgeForUrl('/login');

      expect(content[0]).toContain('token:');
      expect(content[0]).not.toContain('${env.');
    });

    it('should leave unknown namespaces untouched', () => {
      writeKnowledgeFile('page.md', '/page', 'value: ${custom.baseUrl}');

      const tracker = new KnowledgeTracker();
      const content = tracker.getKnowledgeForUrl('/page');

      expect(content[0]).toContain('${custom.baseUrl}');
    });

    it('should leave expressions without namespace untouched', () => {
      writeKnowledgeFile('page.md', '/page', 'value: ${somevar}');

      const tracker = new KnowledgeTracker();
      const content = tracker.getKnowledgeForUrl('/page');

      expect(content[0]).toContain('${somevar}');
    });

    it('should handle mixed content with env vars and plain text', () => {
      process.env.TEST_USER = 'testuser';

      writeKnowledgeFile('login.md', '/login', 'Login as ${env.TEST_USER} on the main page\nThen check dashboard');

      const tracker = new KnowledgeTracker();
      const content = tracker.getKnowledgeForUrl('/login');

      expect(content[0]).toContain('Login as testuser on the main page');
      expect(content[0]).toContain('Then check dashboard');

      process.env.TEST_USER = undefined;
    });

    it('should replace ${config.*} with config values', () => {
      writeKnowledgeFile('page.md', '/page', 'Base URL: ${config.playwright.url}\nBrowser: ${config.playwright.browser}');

      const tracker = new KnowledgeTracker();
      const content = tracker.getKnowledgeForUrl('/page');

      expect(content[0]).toContain('Base URL: http://localhost:3000');
      expect(content[0]).toContain('Browser: chromium');
    });

    it('should replace missing config paths with empty string', () => {
      writeKnowledgeFile('page.md', '/page', 'value: ${config.nonexistent.path}');

      const tracker = new KnowledgeTracker();
      const content = tracker.getKnowledgeForUrl('/page');

      expect(content[0]).toContain('value:');
      expect(content[0]).not.toContain('${config.');
    });

    it('should replace object config values with empty string', () => {
      writeKnowledgeFile('page.md', '/page', 'value: ${config.playwright}');

      const tracker = new KnowledgeTracker();
      const content = tracker.getKnowledgeForUrl('/page');

      expect(content[0]).toContain('value:');
      expect(content[0]).not.toContain('${config.');
    });
  });
});
