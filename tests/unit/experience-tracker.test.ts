import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, rmSync } from 'node:fs';
import { ActionResult } from '../../src/action-result';
import { ConfigParser } from '../../src/config';
import { ExperienceTracker } from '../../src/experience-tracker';

describe('ExperienceTracker', () => {
  let experienceTracker: ExperienceTracker;
  const testDir = '/tmp/experience';

  beforeEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }

    const mockConfig = {
      playwright: { browser: 'chromium', url: 'http://localhost:3000' },
      ai: { model: 'test' },
      dirs: {
        knowledge: '/tmp/explorbot-test/knowledge',
        experience: 'experience',
      },
    };

    const configParser = ConfigParser.getInstance();
    (configParser as any).config = mockConfig;
    (configParser as any).configPath = '/tmp/config.js';

    experienceTracker = new ExperienceTracker();
  });

  afterEach(() => {
    experienceTracker.cleanup();

    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('constructor', () => {
    it('should create experience tracker with proper directory setup', () => {
      expect(experienceTracker).toBeInstanceOf(ExperienceTracker);
      expect(existsSync(testDir)).toBe(true);
    });
  });

  describe('writeAction', () => {
    it('should save action to experience file', () => {
      const actionResult = new ActionResult({
        html: '<html><body>Dashboard</body></html>',
        url: 'https://example.com/dashboard',
        title: 'Dashboard',
      });

      experienceTracker.writeAction(actionResult, { title: 'Navigate to dashboard', code: 'I.click("Dashboard")' });

      const stateHash = actionResult.getStateHash();
      const { content } = experienceTracker.readExperienceFile(stateHash);

      expect(content).toContain('## ACTION: navigate to dashboard');
      expect(content).toContain('I.click("Dashboard")');
    });

    it('should prepend new action before existing content', () => {
      const actionResult = new ActionResult({
        html: '<html><body>Test</body></html>',
        url: 'https://example.com/test',
        title: 'Test',
      });

      experienceTracker.writeAction(actionResult, { title: 'Click first', code: 'I.click("#first")' });
      experienceTracker.writeAction(actionResult, { title: 'Click second', code: 'I.click("#second")' });

      const stateHash = actionResult.getStateHash();
      const { content } = experienceTracker.readExperienceFile(stateHash);

      const firstIndex = content.indexOf('click second');
      const secondIndex = content.indexOf('click first');
      expect(firstIndex).toBeGreaterThanOrEqual(0);
      expect(secondIndex).toBeGreaterThanOrEqual(0);
      expect(firstIndex).toBeLessThan(secondIndex);
    });

    it('should skip duplicate actions', () => {
      const actionResult = new ActionResult({
        html: '<html><body>Test</body></html>',
        url: 'https://example.com/test',
        title: 'Test',
      });

      const code = 'I.click("#submit")';

      experienceTracker.writeAction(actionResult, { title: 'Submit form', code });
      experienceTracker.writeAction(actionResult, { title: 'Submit form again', code });

      const stateHash = actionResult.getStateHash();
      const { content } = experienceTracker.readExperienceFile(stateHash);

      const matches = content.match(/I\.click\("#submit"\)/g);
      expect(matches).toHaveLength(1);
    });
  });

  describe('getRelevantExperience', () => {
    it('includes experience from descendant URL paths when requested', async () => {
      const parent = new ActionResult({
        html: '<html><body>P</body></html>',
        url: 'https://example.com/parent',
        title: 'Parent',
      });
      const child = new ActionResult({
        html: '<html><body>C</body></html>',
        url: 'https://example.com/parent/child',
        title: 'Child',
      });

      experienceTracker.writeAction(parent, { title: 'p', code: 'I.click("p")' });
      experienceTracker.writeAction(child, { title: 'c', code: 'I.click("c")' });

      const exactOnly = experienceTracker.getRelevantExperience(parent);
      expect(exactOnly).toHaveLength(1);

      const withDesc = experienceTracker.getRelevantExperience(parent, { includeDescendantExperience: true });
      expect(withDesc).toHaveLength(2);
    });
  });

  describe('readExperienceFile', () => {
    it('should read existing experience file with frontmatter and content', () => {
      const actionResult = new ActionResult({
        html: '<html><body>Test</body></html>',
        url: 'https://example.com/test',
        title: 'Test Page',
      });

      experienceTracker.writeAction(actionResult, { title: 'Test action', code: 'I.click("Test")' });

      const stateHash = actionResult.getStateHash();
      const { content, data } = experienceTracker.readExperienceFile(stateHash);

      expect(content).toContain('## ACTION: test action');
      expect(content).toContain('I.click("Test")');
      expect(data.url).toBe('/test');
      expect(data.title).toBe('Test Page');
    });
  });

  describe('writeExperienceFile', () => {
    it('should write experience file with custom content and frontmatter', () => {
      const stateHash = 'test-hash';
      const content = '### Custom Experience\n\nThis is custom content.';
      const frontmatter = {
        url: '/custom',
        title: 'Custom Page',
        custom: 'metadata',
      };

      experienceTracker.writeExperienceFile(stateHash, content, frontmatter);

      const { content: readContent, data } = experienceTracker.readExperienceFile(stateHash);

      expect(readContent.trim()).toBe(content.trim());
      expect(data.url).toBe('/custom');
      expect(data.title).toBe('Custom Page');
      expect(data.custom).toBe('metadata');
    });
  });

  describe('getAllExperience', () => {
    it('should return empty array when no experience files exist', () => {
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }

      const experiences = experienceTracker.getAllExperience();
      expect(experiences).toEqual([]);
    });

    it('should return all experience files from directory', async () => {
      const actionResult1 = new ActionResult({
        html: '<html><body>Page 1</body></html>',
        url: 'https://example.com/page1',
        title: 'Page 1',
      });

      const actionResult2 = new ActionResult({
        html: '<html><body>Page 2</body></html>',
        url: 'https://example.com/page2',
        title: 'Page 2',
      });

      experienceTracker.writeAction(actionResult1, { title: 'Action 1', code: 'I.click("Link1")' });
      experienceTracker.writeExperienceFile(actionResult2.getStateHash(), '### Test content with I.click("Link2")', {
        url: '/page2',
        title: 'Page 2',
      });

      const experiences = experienceTracker.getAllExperience();

      expect(experiences).toHaveLength(2);

      const page1Experience = experiences.find((exp) => exp.data.title === 'Page 1');
      const page2Experience = experiences.find((exp) => exp.data.title === 'Page 2');

      expect(page1Experience).toBeTruthy();
      expect(page2Experience).toBeTruthy();
      expect(page1Experience?.content).toContain('I.click("Link1")');
      expect(page2Experience?.content).toContain('I.click("Link2")');
    });

    it('should handle file reading errors gracefully', () => {
      const experiences = experienceTracker.getAllExperience();
      expect(Array.isArray(experiences)).toBe(true);
    });
  });

  describe('writeFlow trimming', () => {
    function makeState() {
      return new ActionResult({
        html: '<html><body>Test</body></html>',
        url: 'https://example.com/suite/abc',
        title: 'Suite',
      });
    }

    it('should save valid flow with heading and code', () => {
      const state = makeState();
      experienceTracker.writeFlow(state, {
        scenario: 'Create a test',
        steps: [{ message: 'Click create', status: 'passed', code: 'I.click("Create")' }],
      });
      const { content } = experienceTracker.readExperienceFile(state.getStateHash());
      expect(content).toContain('## FLOW: create a test');
      expect(content).toContain('I.click("Create")');
    });

    it('should reject flow with no code blocks', () => {
      const state = makeState();
      experienceTracker.writeFlow(state, {
        scenario: 'Empty flow',
        steps: [{ message: 'Did nothing useful', status: 'passed' }],
      });
      const stateHash = state.getStateHash();
      const filePath = `/tmp/experience/${stateHash}.md`;
      if (existsSync(filePath)) {
        const { content } = experienceTracker.readExperienceFile(stateHash);
        expect(content.trim()).toBe('');
      }
    });

    it('should trim code blocks to max 2', () => {
      const state = makeState();
      experienceTracker.writeFlow(state, {
        scenario: 'Many steps',
        steps: [
          { message: 'Step 1', status: 'passed', code: 'I.click("A")' },
          { message: 'Step 2', status: 'passed', code: 'I.click("B")' },
          { message: 'Step 3', status: 'passed', code: 'I.click("C")' },
          { message: 'Step 4', status: 'passed', code: 'I.click("D")' },
        ],
      });
      const { content } = experienceTracker.readExperienceFile(state.getStateHash());
      const codeMatches = content.match(/```js/g) || [];
      expect(codeMatches.length).toBeLessThanOrEqual(2);
    });

    it('should trim blockquotes to max 5', () => {
      const state = makeState();
      const discoveries = Array.from({ length: 10 }, (_, i) => `A new button appeared: Btn${i}`).join('\n');
      experienceTracker.writeFlow(state, {
        scenario: 'Many discoveries',
        steps: [{ message: 'Click something', status: 'passed', code: 'I.click("X")', discovery: discoveries }],
      });
      const { content } = experienceTracker.readExperienceFile(state.getStateHash());
      const bqMatches = content.match(/^>/gm) || [];
      expect(bqMatches.length).toBeLessThanOrEqual(5);
    });

    it('should trim content to max 40 lines', () => {
      const state = makeState();
      const steps = Array.from({ length: 2 }, (_, i) => ({
        message: `Step ${i}`,
        status: 'passed' as const,
        code: `I.click("Btn${i}")`,
        discovery: Array.from({ length: 5 }, (_, j) => `A new element appeared: El${i}_${j}`).join('\n'),
      }));
      experienceTracker.writeFlow(state, {
        scenario: 'Long flow',
        steps,
      });
      const { content } = experienceTracker.readExperienceFile(state.getStateHash());
      const lines = content.split('\n');
      expect(lines.length).toBeLessThanOrEqual(40);
    });
  });

  describe('file path extraction', () => {
    it('should extract proper paths from different URL formats', async () => {
      const testCases = [
        {
          url: 'https://example.com/users/profile',
          expectedPath: '/users/profile',
        },
        {
          url: '/dashboard',
          expectedPath: '/dashboard',
        },
        {
          url: 'https://example.com/page#section',
          expectedPath: '/page#section',
        },
      ];

      for (const testCase of testCases) {
        const actionResult = new ActionResult({
          html: '<html><body>Test</body></html>',
          url: testCase.url,
          title: 'Test',
        });

        experienceTracker.writeAction(actionResult, { title: 'Test action', code: 'I.click("test")' });

        const stateHash = actionResult.getStateHash();
        const { data } = experienceTracker.readExperienceFile(stateHash);

        expect(data.url).toBe(testCase.expectedPath);
      }
    });
  });
});
