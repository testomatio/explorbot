import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Command } from 'commander';
import matter from 'gray-matter';
import { ActionResult } from '../../src/action-result.js';
import { APPLICATION_SPEC_FORMAT, APPLICATION_SPEC_VERSION } from '../../src/application-spec-contract.ts';
import { ConfigParser } from '../../src/config';
import { registerKnowledgeOption } from '../../src/config';
import { KnowledgeTracker } from '../../src/knowledge-tracker';
import { clearRegisteredSecrets, redactSecrets } from '../../src/utils/secrets';

const knowledgeDir = '/tmp/explorbot-test-knowledge';
const applicationSpecDir = '/tmp/explorbot-test-application-spec';

describe('KnowledgeTracker', () => {
  beforeEach(() => {
    if (existsSync(knowledgeDir)) {
      rmSync(knowledgeDir, { recursive: true, force: true });
    }
    if (existsSync(applicationSpecDir)) {
      rmSync(applicationSpecDir, { recursive: true, force: true });
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
    if (existsSync(applicationSpecDir)) {
      rmSync(applicationSpecDir, { recursive: true, force: true });
    }
  });

  function writeKnowledgeFile(filename: string, url: string, content: string) {
    const fileContent = matter.stringify(content, { url });
    writeFileSync(`${knowledgeDir}/${filename}`, fileContent, 'utf8');
  }

  describe('renderRelevantKnowledge', () => {
    it('returns empty string when no knowledge matches the page', () => {
      const tracker = new KnowledgeTracker();
      const state = new ActionResult({ url: '/nothing-here', html: '<html></html>' });
      expect(tracker.renderRelevantKnowledge(state)).toBe('');
    });

    it('renders a tagged knowledge block for a matching page', () => {
      writeKnowledgeFile('login.md', '/login', 'Use admin credentials');
      const tracker = new KnowledgeTracker();
      const state = new ActionResult({ url: '/login', html: '<html></html>' });

      const rendered = tracker.renderRelevantKnowledge(state);

      expect(rendered).toContain('<knowledge>');
      expect(rendered).toContain('Use admin credentials');
      expect(rendered).toContain('</knowledge>');
    });

    it('combines matching knowledge with a configured application spec', () => {
      writeKnowledgeFile('login.md', '/login', 'Use admin credentials');
      mkdirSync(`${applicationSpecDir}/pages`, { recursive: true });
      writeFileSync(`${applicationSpecDir}/index.md`, '# Website Spec', 'utf8');
      writeFileSync(
        `${applicationSpecDir}/pages/login.md`,
        matter.stringify('# /login\n\n## Purpose\n\nSign in to the application.', {
          url: '/login',
          format: APPLICATION_SPEC_FORMAT,
          version: APPLICATION_SPEC_VERSION,
        }),
        'utf8'
      );
      const tracker = new KnowledgeTracker({ applicationSpec: applicationSpecDir });
      const state = new ActionResult({ url: '/login', html: '<html></html>' });

      const rendered = tracker.renderRelevantContext(state);

      expect(rendered).toContain('<knowledge>');
      expect(rendered).toContain('<application_spec>');
      expect(rendered).toContain('Sign in to the application.');
    });

    it('loads an application spec from the configured directory', () => {
      mkdirSync(`${applicationSpecDir}/pages`, { recursive: true });
      writeFileSync(`${applicationSpecDir}/index.md`, '# Website Spec', 'utf8');
      writeFileSync(
        `${applicationSpecDir}/pages/login.md`,
        matter.stringify('# /login\n\n## Purpose\n\nSign in to the application.', {
          url: '/login',
          format: APPLICATION_SPEC_FORMAT,
          version: APPLICATION_SPEC_VERSION,
        }),
        'utf8'
      );
      (ConfigParser.getInstance() as any).config.dirs.spec = 'explorbot-test-application-spec';

      const tracker = new KnowledgeTracker();
      const rendered = tracker.renderApplicationSpec(new ActionResult({ url: '/login' }));

      expect(rendered).toContain('Sign in to the application.');
    });
  });

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

    it('should block credential-named config keys from interpolating', () => {
      (ConfigParser.getInstance() as any).config.ai.apiKey = 'sk-should-not-leak';
      writeKnowledgeFile('page.md', '/page', 'key: ${config.ai.apiKey}');

      const tracker = new KnowledgeTracker();
      const content = tracker.getKnowledgeForUrl('/page');

      expect(content[0]).not.toContain('sk-should-not-leak');
      expect(content[0]).not.toContain('${config.');
    });

    it('should register env secrets so they are redacted at sinks', () => {
      clearRegisteredSecrets();
      process.env.APP_PASSWORD = 'hunter2secret';

      writeKnowledgeFile('login.md', '/login', 'password: ${env.APP_PASSWORD}');

      const tracker = new KnowledgeTracker();
      const content = tracker.getKnowledgeForUrl('/login');

      expect(content[0]).toContain('password: hunter2secret');
      expect(redactSecrets('typed hunter2secret into the field')).toBe('typed ***REDACTED*** into the field');

      process.env.APP_PASSWORD = undefined;
      clearRegisteredSecrets();
    });
  });

  describe('recursive scan', () => {
    it('loads knowledge from nested subdirectories', () => {
      mkdirSync(`${knowledgeDir}/subdir`, { recursive: true });
      writeFileSync(`${knowledgeDir}/subdir/nested.md`, matter.stringify('Nested note', { url: '/nested-page' }), 'utf8');

      const tracker = new KnowledgeTracker();
      const content = tracker.getKnowledgeForUrl('/nested-page');

      expect(content[0]).toContain('Nested note');
    });
  });

  describe('addKnowledge cache invalidation', () => {
    it('sees knowledge added via addKnowledge on the same instance', () => {
      const tracker = new KnowledgeTracker();
      expect(tracker.getMatchingKnowledge('/login')).toHaveLength(0);

      tracker.addKnowledge('/login', 'Use admin credentials');

      const matched = tracker.getMatchingKnowledge('/login');
      expect(matched.length).toBeGreaterThan(0);
      expect(matched[0].content).toContain('Use admin credentials');
    });

    it('replaces existing knowledge with the replace option instead of appending', () => {
      const tracker = new KnowledgeTracker();
      tracker.addKnowledge('/login', 'first entry');

      tracker.addKnowledge('/login', 'corrected entry', { replace: true });

      const matched = tracker.getMatchingKnowledge('/login');
      expect(matched[0].content).toContain('corrected entry');
      expect(matched[0].content).not.toContain('first entry');
    });
  });

  describe('session knowledge', () => {
    it('applies knowledge without frontmatter to every page and endpoint', () => {
      const tracker = new KnowledgeTracker({ knowledge: ['My credit card is 4111 1111 1111 1111'] });

      expect(tracker.renderRelevantKnowledge(new ActionResult({ url: '/pay' }))).toContain('4111 1111 1111 1111');
      expect(tracker.renderRelevantKnowledge(new ActionResult({ url: '/anywhere-else' }))).toContain('4111 1111 1111 1111');
      expect(tracker.renderEndpointKnowledge('/payments')).toContain('4111 1111 1111 1111');
    });

    it('scopes knowledge with url frontmatter to matching pages only', () => {
      const tracker = new KnowledgeTracker({ knowledge: [matter.stringify('Card expires 12/30', { url: '/pay' })] });

      expect(tracker.renderRelevantKnowledge(new ActionResult({ url: '/pay' }))).toContain('Card expires 12/30');
      expect(tracker.renderRelevantKnowledge(new ActionResult({ url: '/dashboard' }))).toBe('');
      expect(tracker.renderEndpointKnowledge('/pay')).toBe('');
    });

    it('scopes knowledge with endpoint frontmatter to matching endpoints', () => {
      const tracker = new KnowledgeTracker({ knowledge: [matter.stringify('Send X-Token header', { endpoint: '/users/*' })] });

      expect(tracker.renderEndpointKnowledge('/users/42')).toContain('Send X-Token header');
      expect(tracker.renderEndpointKnowledge('/orders')).toBe('');
    });

    it('keeps several entries independent', () => {
      const tracker = new KnowledgeTracker({
        knowledge: [matter.stringify('Login as admin', { url: '/login' }), matter.stringify('Use the sandbox card', { url: '/pay' })],
      });

      const rendered = tracker.renderRelevantKnowledge(new ActionResult({ url: '/pay' }));
      expect(rendered).toContain('Use the sandbox card');
      expect(rendered).not.toContain('Login as admin');
    });

    it('exposes frontmatter hints through state parameters', () => {
      const tracker = new KnowledgeTracker({ knowledge: [matter.stringify('Slow page', { url: '/reports', wait: 3000 })] });

      expect(tracker.getStateParameters(new ActionResult({ url: '/reports' }), ['wait'])).toEqual({ wait: 3000 });
    });

    it('interpolates environment variables', () => {
      process.env.EXPLORBOT_TEST_TOKEN = 'abc123';
      const tracker = new KnowledgeTracker({ knowledge: ['Token is ${env.EXPLORBOT_TEST_TOKEN}'] });

      expect(tracker.renderRelevantKnowledge(new ActionResult({ url: '/any' }))).toContain('Token is abc123');
      Reflect.deleteProperty(process.env, 'EXPLORBOT_TEST_TOKEN');
    });

    it('reaches the tracker from a --knowledge flag anywhere on the command line', () => {
      const program = new Command();
      registerKnowledgeOption(program);
      const rendered: string[] = [];
      program.command('explore <path>').action(() => {
        rendered.push(new KnowledgeTracker().renderRelevantKnowledge(new ActionResult({ url: '/pay' })));
      });

      program.parse(['explore', '/', '--knowledge', matter.stringify('Use the sandbox card', { url: '/pay' })], { from: 'user' });
      program.parse(['explore', '/'], { from: 'user' });

      expect(rendered[0]).toContain('Use the sandbox card');
      expect(rendered[1]).toBe('');
    });

    it('never writes session knowledge to the knowledge directory', () => {
      const tracker = new KnowledgeTracker({ knowledge: ['Temporary fact'] });
      tracker.renderRelevantKnowledge(new ActionResult({ url: '/any' }));

      expect(tracker.listAllKnowledge()).toHaveLength(0);
      expect(readdirSync(knowledgeDir)).toHaveLength(0);
    });
  });
});
