import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ReporterConfig } from '../../src/config.ts';
import { ConfigParser } from '../../src/config.ts';
import { Reporter } from '../../src/reporter.ts';
import { ActiveNote, Plan, Task, Test, TestResult } from '../../src/test-plan.ts';

class TestableReporter extends Reporter {
  public combineStepsAndNotes(test: Test, lastScreenshotFile?: string) {
    return super.combineStepsAndNotes(test, lastScreenshotFile);
  }
}

describe('Task - ActiveNote', () => {
  test('should create active note with start time', () => {
    const task = new Task('test task');
    const note = task.startNote('Test note');

    expect(note).toBeInstanceOf(ActiveNote);
    expect(note.getMessage()).toBe('Test note');
    expect(note.getStartTime()).toBeGreaterThan(0);
  });

  test('should commit note and store it with end time', () => {
    const task = new Task('test task');
    const note = task.startNote('Test note', TestResult.PASSED);

    note.commit();

    const notes = Object.values(task.notes);
    expect(notes.length).toBe(1);
    expect(notes[0].message).toBe('Test note');
    expect(notes[0].status).toBe(TestResult.PASSED);
    expect(notes[0].startTime).toBeGreaterThan(0);
    expect(notes[0].endTime).toBeGreaterThan(notes[0].startTime);
  });

  test('should auto-commit previous note when starting new one', () => {
    const task = new Task('test task');

    const note1 = task.startNote('First note');
    const note2 = task.startNote('Second note');

    const notes = Object.values(task.notes);
    expect(notes.length).toBe(1);
    expect(notes[0].message).toBe('First note');
    expect(notes[0].status).toBeUndefined();
  });

  test('should commit with final status overriding initial status', () => {
    const task = new Task('test task');
    const note = task.startNote('Test note', TestResult.PASSED);

    note.commit(TestResult.FAILED);

    const notes = Object.values(task.notes);
    expect(notes[0].status).toBe(TestResult.FAILED);
  });

  test('should include steps within note time window', async () => {
    const task = new Task('test task');

    const note = task.startNote('Test note');
    await new Promise((resolve) => setTimeout(resolve, 10));
    task.addStep('I.click("button")', 100, 'passed');
    await new Promise((resolve) => setTimeout(resolve, 10));
    task.addStep('I.see("Success")', 50, 'passed');
    note.commit();

    const steps = Object.values(task.steps);
    expect(steps.length).toBe(2);
    expect(steps[0].text).toBe('I.click("button")');
    expect(steps[0].status).toBe('passed');
    expect(steps[1].text).toBe('I.see("Success")');
  });

  test('should not add steps when no active note', () => {
    const task = new Task('test task');

    task.addStep('I.click("button")', 100);

    const steps = Object.values(task.steps);
    expect(steps.length).toBe(1);
  });

  test('should group multiple notes with their steps', async () => {
    const task = new Task('test task');

    const note1 = task.startNote('First action');
    await new Promise((resolve) => setTimeout(resolve, 10));
    task.addStep('I.click("button1")', 100, 'passed');
    note1.commit();

    await new Promise((resolve) => setTimeout(resolve, 10));

    const note2 = task.startNote('Second action');
    await new Promise((resolve) => setTimeout(resolve, 10));
    task.addStep('I.click("button2")', 150, 'passed');
    note2.commit();

    const notes = Object.values(task.notes);
    expect(notes.length).toBe(2);

    const steps = Object.values(task.steps);
    expect(steps.length).toBe(2);
  });
});

describe('Reporter', () => {
  describe('combineStepsAndNotes - with ActiveNote', () => {
    test('should group steps into notes based on time windows', async () => {
      const reporter = new TestableReporter();
      const test = new Test('Test Scenario', 'high', ['Expected outcome'], 'https://example.com');

      const note1 = test.startNote('Login attempt');
      await new Promise((resolve) => setTimeout(resolve, 10));
      test.addStep('I.fillField("username", "user")', 50, 'passed');
      test.addStep('I.fillField("password", "pass")', 30, 'passed');
      test.addStep('I.click("Login")', 100, 'passed');
      note1.commit(TestResult.PASSED);

      await new Promise((resolve) => setTimeout(resolve, 10));

      const note2 = test.startNote('Verify dashboard');
      await new Promise((resolve) => setTimeout(resolve, 10));
      test.addStep('I.see("Welcome")', 20, 'passed');
      test.addStep('I.see("Dashboard")', 15, 'passed');
      note2.commit(TestResult.PASSED);

      const steps = reporter.combineStepsAndNotes(test);

      expect(steps.length).toBe(2);

      expect(steps[0].category).toBe('user');
      expect(steps[0].title).toBe('Login attempt');
      expect(steps[0].steps?.length).toBe(3);
      expect(steps[0].steps?.[0].title).toBe('I.fillField("username", "user")');
      expect(steps[0].steps?.[0].duration).toBe(50);
      expect(steps[0].steps?.[1].title).toBe('I.fillField("password", "pass")');
      expect(steps[0].steps?.[2].title).toBe('I.click("Login")');

      expect(steps[1].category).toBe('user');
      expect(steps[1].title).toBe('Verify dashboard');
      expect(steps[1].steps?.length).toBe(2);
      expect(steps[1].steps?.[0].title).toBe('I.see("Welcome")');
      expect(steps[1].steps?.[1].title).toBe('I.see("Dashboard")');
    });

    test('should include error in step when step fails', async () => {
      const reporter = new TestableReporter();
      const test = new Test('Test Scenario', 'high', ['Expected outcome'], 'https://example.com');

      const note = test.startNote('Login attempt');
      await new Promise((resolve) => setTimeout(resolve, 10));
      test.addStep('I.fillField("username", "user")', 50, 'passed');
      test.addStep('I.click("Login")', 100, 'failed', 'Element not found');
      note.commit(TestResult.FAILED);

      const steps = reporter.combineStepsAndNotes(test);

      expect(steps.length).toBe(1);
      expect(steps[0].steps?.length).toBe(2);
      expect(steps[0].steps?.[1].title).toBe('I.click("Login")');
      expect(steps[0].steps?.[1].error).toBe('Element not found');
    });

    test('should ignore steps outside any note time window', async () => {
      const reporter = new TestableReporter();
      const test = new Test('Test Scenario', 'high', ['Expected outcome'], 'https://example.com');

      const note = test.startNote('Login attempt');
      await new Promise((resolve) => setTimeout(resolve, 10));
      test.addStep('I.fillField("username", "user")', 50, 'passed');
      note.commit(TestResult.PASSED);

      await new Promise((resolve) => setTimeout(resolve, 10));

      test.addStep('I.click("orphan")', 100, 'passed');

      const steps = reporter.combineStepsAndNotes(test);

      expect(steps.length).toBe(1);
      expect(steps[0].title).toBe('Login attempt');
      expect(steps[0].steps?.length).toBe(1);
      expect(steps[0].steps?.[0].title).toBe('I.fillField("username", "user")');
    });

    test('should handle note without steps', async () => {
      const reporter = new TestableReporter();
      const test = new Test('Test Scenario', 'high', ['Expected outcome'], 'https://example.com');

      const note = test.startNote('Just a note');
      note.commit(TestResult.PASSED);

      const steps = reporter.combineStepsAndNotes(test);

      expect(steps.length).toBe(1);
      expect(steps[0].category).toBe('user');
      expect(steps[0].title).toBe('Just a note');
      expect(steps[0].steps).toBeUndefined();
    });

    test('should handle empty test', () => {
      const reporter = new TestableReporter();
      const test = new Test('Test Scenario', 'high', ['Expected outcome'], 'https://example.com');

      const steps = reporter.combineStepsAndNotes(test);

      expect(steps.length).toBe(0);
    });

    test('should handle auto-commit when starting new note', async () => {
      const reporter = new TestableReporter();
      const test = new Test('Test Scenario', 'high', ['Expected outcome'], 'https://example.com');

      const note1 = test.startNote('First note');
      await new Promise((resolve) => setTimeout(resolve, 10));
      test.addStep('I.click("btn1")', 50, 'passed');

      const note2 = test.startNote('Second note');
      await new Promise((resolve) => setTimeout(resolve, 10));
      test.addStep('I.click("btn2")', 50, 'passed');
      note2.commit(TestResult.PASSED);

      const steps = reporter.combineStepsAndNotes(test);

      expect(steps.length).toBe(2);
      expect(steps[0].title).toBe('First note');
      expect(steps[0].steps?.length).toBe(1);
      expect(steps[1].title).toBe('Second note');
      expect(steps[1].steps?.length).toBe(1);
    });

    test('should handle notes with zero duration', () => {
      const reporter = new TestableReporter();
      const test = new Test('Test Scenario', 'high', ['Expected outcome'], 'https://example.com');

      const note = test.startNote('Instant note');
      note.commit();

      const notes = Object.values(test.notes);
      expect(notes[0].endTime).toBeGreaterThanOrEqual(notes[0].startTime);
    });
  });
});

describe('Reporter config', () => {
  let savedTestomatio: string | undefined;
  let savedHtmlSave: string | undefined;
  let savedHtmlFolder: string | undefined;

  function clearEnv(key: string) {
    delete process.env[key];
  }

  function restoreEnv(key: string, value: string | undefined) {
    if (value !== undefined) {
      process.env[key] = value;
    } else {
      clearEnv(key);
    }
  }

  beforeEach(() => {
    const configParser = ConfigParser.getInstance();
    (configParser as any).config = { dirs: { output: '/tmp/explorbot-test' } };
    (configParser as any).configPath = '/tmp/explorbot.config.js';
    savedTestomatio = process.env.TESTOMATIO;
    savedHtmlSave = process.env.TESTOMATIO_HTML_REPORT_SAVE;
    savedHtmlFolder = process.env.TESTOMATIO_HTML_REPORT_FOLDER;
    clearEnv('TESTOMATIO');
    clearEnv('TESTOMATIO_HTML_REPORT_SAVE');
    clearEnv('TESTOMATIO_HTML_REPORT_FOLDER');
  });

  afterEach(() => {
    restoreEnv('TESTOMATIO', savedTestomatio);
    restoreEnv('TESTOMATIO_HTML_REPORT_SAVE', savedHtmlSave);
    restoreEnv('TESTOMATIO_HTML_REPORT_FOLDER', savedHtmlFolder);
  });

  test('enabled: true without TESTOMATIO sets HTML report env vars', () => {
    const reporter = new Reporter({ enabled: true });
    expect(process.env.TESTOMATIO_HTML_REPORT_SAVE).toBe('1');
    expect(process.env.TESTOMATIO_HTML_REPORT_FOLDER).toContain('reports');
  });

  test('enabled: true with TESTOMATIO does not set HTML env vars', () => {
    process.env.TESTOMATIO = 'tstmt_test_key';
    const reporter = new Reporter({ enabled: true });
    expect(process.env.TESTOMATIO_HTML_REPORT_SAVE).toBeUndefined();
  });

  test('enabled: false does not set HTML env vars', () => {
    const reporter = new Reporter({ enabled: false });
    expect(process.env.TESTOMATIO_HTML_REPORT_SAVE).toBeUndefined();
  });

  test('enabled: false with TESTOMATIO does not set HTML env vars', () => {
    process.env.TESTOMATIO = 'tstmt_test_key';
    const reporter = new Reporter({ enabled: false });
    expect(process.env.TESTOMATIO_HTML_REPORT_SAVE).toBeUndefined();
  });

  test('undefined config with TESTOMATIO does not set HTML env vars', () => {
    process.env.TESTOMATIO = 'tstmt_test_key';
    const reporter = new Reporter();
    expect(process.env.TESTOMATIO_HTML_REPORT_SAVE).toBeUndefined();
  });

  test('undefined config without TESTOMATIO does not set HTML env vars', () => {
    const reporter = new Reporter();
    expect(process.env.TESTOMATIO_HTML_REPORT_SAVE).toBeUndefined();
  });

  test('html: true with TESTOMATIO also sets HTML env vars', () => {
    process.env.TESTOMATIO = 'tstmt_test_key';
    const reporter = new Reporter({ enabled: true, html: true });
    expect(process.env.TESTOMATIO_HTML_REPORT_SAVE).toBe('1');
    expect(process.env.TESTOMATIO_HTML_REPORT_FOLDER).toContain('reports');
  });
});
