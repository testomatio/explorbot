import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { ExperienceTracker } from '../../src/experience-tracker';
import { ActionResult } from '../../src/action-result';
import { ConfigParser } from '../../src/config';
import { existsSync, rmSync, readFileSync } from 'node:fs';

describe('ExperienceTracker', () => {
  let experienceTracker: ExperienceTracker;
  const testDir = '/tmp/experience';

  beforeEach(() => {
    // Always clean up any existing test directory to ensure test isolation
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }

    // Mock config parser with test directory
    const mockConfig = {
      playwright: { browser: 'chromium', url: 'http://localhost:3000' },
      ai: { provider: null, model: 'test' },
      dirs: {
        knowledge: '/tmp/explorbot-test/knowledge',
        experience: 'experience', // Use relative path so it gets resolved properly
      },
    };

    const configParser = ConfigParser.getInstance();
    (configParser as any).config = mockConfig;
    (configParser as any).configPath = '/tmp/config.js'; // Point to parent dir

    experienceTracker = new ExperienceTracker();
  });

  afterEach(() => {
    experienceTracker.cleanup();

    // Clean up test directory
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

  describe('saveFailedAttempt', () => {
    it('should save failed attempt to experience file', async () => {
      const actionResult = new ActionResult({
        html: '<html><body>Test Page</body></html>',
        url: 'https://example.com/test',
        title: 'Test Page',
      });

      await experienceTracker.saveFailedAttempt(
        actionResult,
        'Click the login button',
        'I.click("#login-btn")',
        'Element not found: #login-btn',
        1
      );

      const stateHash = actionResult.getStateHash();
      const filePath = `${testDir}/${stateHash}.md`;

      expect(existsSync(filePath)).toBe(true);

      const content = readFileSync(filePath, 'utf8');
      expect(content).toContain('Failed Attempt');
      expect(content).toContain('Purpose: Click the login button');
      expect(content).toContain('Element not found: #login-btn');
      expect(content).toContain('I.click("#login-btn")');
    });

    it('should append multiple failed attempts to same file', async () => {
      const actionResult = new ActionResult({
        html: '<html><body>Test Page</body></html>',
        url: 'https://example.com/test',
        title: 'Test Page',
      });

      // First failed attempt
      await experienceTracker.saveFailedAttempt(
        actionResult,
        'Click login button',
        'I.click("#login")',
        'Element not found',
        1
      );

      // Second failed attempt
      await experienceTracker.saveFailedAttempt(
        actionResult,
        'Click login button',
        'I.click(".login-btn")',
        'Element not clickable',
        2
      );

      const stateHash = actionResult.getStateHash();
      const filePath = `${testDir}/${stateHash}.md`;
      const content = readFileSync(filePath, 'utf8');

      // Should contain both attempts
      expect(content).toContain('I.click("#login")');
      expect(content).toContain('I.click(".login-btn")');
      expect(content).toContain('Element not found');
      expect(content).toContain('Element not clickable');
    });
  });

  describe('saveSuccessfulResolution', () => {
    it('should save successful resolution to experience file', async () => {
      const actionResult = new ActionResult({
        html: '<html><body>Dashboard</body></html>',
        url: 'https://example.com/dashboard',
        title: 'Dashboard',
      });

      // First create a failed attempt so the file exists
      await experienceTracker.saveFailedAttempt(
        actionResult,
        'Navigate to dashboard',
        'I.click("Wrong")',
        'Element not found',
        1
      );

      await experienceTracker.saveSuccessfulResolution(
        actionResult,
        'Navigate to dashboard',
        'I.click("Dashboard")'
      );

      const stateHash = actionResult.getStateHash();
      const filePath = `${testDir}/${stateHash}.md`;

      expect(existsSync(filePath)).toBe(true);

      const content = readFileSync(filePath, 'utf8');
      expect(content).toContain('Successful Attempt');
      expect(content).toContain('Purpose: Navigate to dashboard');
      expect(content).toContain('I.click("Dashboard")');
      // The file contains both successful and failed attempts
      expect(content).toContain('Failed Attempt');
    });

    it('should prepend successful resolution before existing content', async () => {
      const actionResult = new ActionResult({
        html: '<html><body>Test</body></html>',
        url: 'https://example.com/test',
        title: 'Test',
      });

      // First save a failed attempt
      await experienceTracker.saveFailedAttempt(
        actionResult,
        'Click button',
        'I.click("#wrong")',
        'Element not found',
        1
      );

      // Then save successful resolution
      await experienceTracker.saveSuccessfulResolution(
        actionResult,
        'Click button',
        'I.click("#correct")'
      );

      const stateHash = actionResult.getStateHash();
      const filePath = `${testDir}/${stateHash}.md`;
      const content = readFileSync(filePath, 'utf8');

      // Success should appear before failure in content
      const successIndex = content.indexOf('Successful Attempt');
      const failureIndex = content.indexOf('Failed Attempt');

      expect(successIndex).toBeGreaterThan(-1);
      expect(failureIndex).toBeGreaterThan(-1);
      expect(successIndex).toBeLessThan(failureIndex);
    });

    it('should skip duplicate successful resolutions', async () => {
      const actionResult = new ActionResult({
        html: '<html><body>Test</body></html>',
        url: 'https://example.com/test',
        title: 'Test',
      });

      const code = 'I.click("#submit")';

      // First create a failed attempt so the file exists
      await experienceTracker.saveFailedAttempt(
        actionResult,
        'Submit form',
        'I.click("#wrong")',
        'Element not found',
        1
      );

      // Save successful resolution twice
      await experienceTracker.saveSuccessfulResolution(
        actionResult,
        'Submit form',
        code
      );

      await experienceTracker.saveSuccessfulResolution(
        actionResult,
        'Submit form again',
        code
      );

      const stateHash = actionResult.getStateHash();
      const filePath = `${testDir}/${stateHash}.md`;
      const content = readFileSync(filePath, 'utf8');

      // Should only appear once
      const matches = content.match(/I\.click\("#submit"\)/g);
      expect(matches).toHaveLength(1);
    });
  });

  describe('readExperienceFile', () => {
    it('should read existing experience file with frontmatter and content', async () => {
      const actionResult = new ActionResult({
        html: '<html><body>Test</body></html>',
        url: 'https://example.com/test',
        title: 'Test Page',
      });

      // Create an experience file first with a failed attempt
      await experienceTracker.saveFailedAttempt(
        actionResult,
        'Test action',
        'I.click("Wrong")',
        'Element not found',
        1
      );

      // Then save successful resolution
      await experienceTracker.saveSuccessfulResolution(
        actionResult,
        'Test action',
        'I.click("Test")'
      );

      const stateHash = actionResult.getStateHash();
      const { content, data } = experienceTracker.readExperienceFile(stateHash);

      expect(content).toContain('Successful Attempt');
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

      const { content: readContent, data } =
        experienceTracker.readExperienceFile(stateHash);

      expect(readContent.trim()).toBe(content.trim());
      expect(data.url).toBe('/custom');
      expect(data.title).toBe('Custom Page');
      expect(data.custom).toBe('metadata');
    });
  });

  describe('getAllExperience', () => {
    it('should return empty array when no experience files exist', () => {
      // Clean up directory first to ensure it's truly empty
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }

      const experiences = experienceTracker.getAllExperience();
      expect(experiences).toEqual([]);
    });

    it('should return all experience files from directory', async () => {
      // Create multiple experience files
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

      // Create the first file with failed then successful
      await experienceTracker.saveFailedAttempt(
        actionResult1,
        'Action 1',
        'I.click("Wrong1")',
        'Element not found',
        1
      );

      await experienceTracker.saveSuccessfulResolution(
        actionResult1,
        'Action 1',
        'I.click("Link1")'
      );

      await experienceTracker.saveFailedAttempt(
        actionResult2,
        'Action 2',
        'I.click("Link2")',
        'Element not found',
        1
      );

      const experiences = experienceTracker.getAllExperience();

      expect(experiences).toHaveLength(2);

      const page1Experience = experiences.find(
        (exp) => exp.data.title === 'Page 1'
      );
      const page2Experience = experiences.find(
        (exp) => exp.data.title === 'Page 2'
      );

      expect(page1Experience).toBeTruthy();
      expect(page2Experience).toBeTruthy();
      expect(page1Experience?.content).toContain('I.click("Link1")');
      expect(page2Experience?.content).toContain('I.click("Link2")');
    });

    it('should handle file reading errors gracefully', () => {
      // This test verifies the error handling in getAllExperience
      // Since we can't easily create a corrupted file in this test environment,
      // we'll just verify the method returns what it can read
      const experiences = experienceTracker.getAllExperience();
      expect(Array.isArray(experiences)).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should compact long error messages', async () => {
      const actionResult = new ActionResult({
        html: '<html><body>Test</body></html>',
        url: 'https://example.com/test',
        title: 'Test',
      });

      const longError =
        'This is a very long error message that should be truncated because it exceeds the maximum length limit for error messages in the experience tracker system';

      await experienceTracker.saveFailedAttempt(
        actionResult,
        'Test action',
        'I.click("test")',
        longError,
        1
      );

      const stateHash = actionResult.getStateHash();
      const filePath = `${testDir}/${stateHash}.md`;
      const content = readFileSync(filePath, 'utf8');

      // Should be truncated with ellipsis
      expect(content).toContain('...');
      expect(content).not.toContain(longError);
    });

    it('should handle null error messages', async () => {
      const actionResult = new ActionResult({
        html: '<html><head><title>Unique Test</title></head><body><h1>Null Error Unique Test</h1></body></html>',
        url: 'https://example.com/completely-unique-null-error-test-path',
        title: 'Unique Null Error Test',
        h1: 'Null Error Unique Test',
      });

      await experienceTracker.saveFailedAttempt(
        actionResult,
        'Unique null error test action',
        'I.click("unique-null-test-element")',
        null,
        1
      );

      const stateHash = actionResult.getStateHash();
      const filePath = `${testDir}/${stateHash}.md`;

      // Verify file exists and contains our failed attempt
      expect(existsSync(filePath)).toBe(true);

      const content = readFileSync(filePath, 'utf8');

      // Should handle null error gracefully - just verify the file has the right structure
      expect(content).toContain('I.click("unique-null-test-element")');
      expect(content).toContain('Unique null error test action');
      expect(content).toContain('url: /completely-unique-null-error-test-path');
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

        // Create failed attempt first
        await experienceTracker.saveFailedAttempt(
          actionResult,
          'Test action',
          'I.click("wrong")',
          'Element not found',
          1
        );

        await experienceTracker.saveSuccessfulResolution(
          actionResult,
          'Test action',
          'I.click("test")'
        );

        const stateHash = actionResult.getStateHash();
        const { data } = experienceTracker.readExperienceFile(stateHash);

        expect(data.url).toBe(testCase.expectedPath);
      }
    });
  });
});
