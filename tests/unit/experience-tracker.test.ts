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

  describe('saveSuccessfulResolution', () => {
    it('should save successful resolution to experience file', async () => {
      const actionResult = new ActionResult({
        html: '<html><body>Dashboard</body></html>',
        url: 'https://example.com/dashboard',
        title: 'Dashboard',
      });

      await experienceTracker.saveSuccessfulResolution(actionResult, 'Navigate to dashboard', 'I.click("Dashboard")');

      const stateHash = actionResult.getStateHash();
      const { content } = experienceTracker.readExperienceFile(stateHash);

      expect(content).toContain('### SUCCEEDED: Navigate to dashboard');
      expect(content).toContain('I.click("Dashboard")');
    });

    it('should prepend successful resolution before existing content', async () => {
      const actionResult = new ActionResult({
        html: '<html><body>Test</body></html>',
        url: 'https://example.com/test',
        title: 'Test',
      });

      await experienceTracker.saveSuccessfulResolution(actionResult, 'Click first', 'I.click("#first")');
      await experienceTracker.saveSuccessfulResolution(actionResult, 'Click second', 'I.click("#second")');

      const stateHash = actionResult.getStateHash();
      const { content } = experienceTracker.readExperienceFile(stateHash);

      const firstIndex = content.indexOf('Click second');
      const secondIndex = content.indexOf('Click first');
      expect(firstIndex).toBeLessThan(secondIndex);
    });

    it('should skip duplicate successful resolutions', async () => {
      const actionResult = new ActionResult({
        html: '<html><body>Test</body></html>',
        url: 'https://example.com/test',
        title: 'Test',
      });

      const code = 'I.click("#submit")';

      await experienceTracker.saveSuccessfulResolution(actionResult, 'Submit form', code);
      await experienceTracker.saveSuccessfulResolution(actionResult, 'Submit form again', code);

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

      await experienceTracker.saveSuccessfulResolution(parent, 'p', 'I.click("p")');
      await experienceTracker.saveSuccessfulResolution(child, 'c', 'I.click("c")');

      const exactOnly = experienceTracker.getRelevantExperience(parent);
      expect(exactOnly).toHaveLength(1);

      const withDesc = experienceTracker.getRelevantExperience(parent, { includeDescendantExperience: true });
      expect(withDesc).toHaveLength(2);
    });
  });

  describe('readExperienceFile', () => {
    it('should read existing experience file with frontmatter and content', async () => {
      const actionResult = new ActionResult({
        html: '<html><body>Test</body></html>',
        url: 'https://example.com/test',
        title: 'Test Page',
      });

      await experienceTracker.saveSuccessfulResolution(actionResult, 'Test action', 'I.click("Test")');

      const stateHash = actionResult.getStateHash();
      const { content, data } = experienceTracker.readExperienceFile(stateHash);

      expect(content).toContain('### SUCCEEDED: Test action');
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

      await experienceTracker.saveSuccessfulResolution(actionResult1, 'Action 1', 'I.click("Link1")');
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

        await experienceTracker.saveSuccessfulResolution(actionResult, 'Test action', 'I.click("test")');

        const stateHash = actionResult.getStateHash();
        const { data } = experienceTracker.readExperienceFile(stateHash);

        expect(data.url).toBe(testCase.expectedPath);
      }
    });
  });
});
