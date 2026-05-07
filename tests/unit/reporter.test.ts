import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { ReporterConfig } from '../../src/config.ts';
import { ConfigParser } from '../../src/config.ts';
import { Reporter } from '../../src/reporter.ts';
import { Stats } from '../../src/stats.ts';
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

  describe('Verification step', () => {
    beforeEach(() => {
      const configParser = ConfigParser.getInstance();
      (configParser as any).config = { dirs: { output: '/tmp/explorbot-test' } };
      (configParser as any).configPath = '/tmp/explorbot.config.js';
    });

    test('appends a Verification step with pilot message, url, details and screenshot', () => {
      const reporter = new TestableReporter();
      const test = new Test('Sign in', 'high', ['Logged in'], 'https://example.com/login');

      const note = test.startNote('Type credentials');
      test.addStep('I.fillField("email", "x")', 10, 'passed');
      note.commit(TestResult.PASSED);

      test.setVerification('Pilot: Logged-in indicator visible', TestResult.PASSED, {
        screenshotFile: 'final.png',
        fullUrl: 'https://example.com/dashboard',
        title: 'Dashboard',
      });
      test.addVerificationDetail('💡 UX: button label "Go" is ambiguous');

      const steps = reporter.combineStepsAndNotes(test);
      const last = steps[steps.length - 1];

      expect(last.category).toBe('user');
      expect(last.title).toBe('Verification');
      expect(last.status).toBe(TestResult.PASSED);
      expect(last.artifacts?.[0]).toContain('final.png');
      const subSteps = last.steps || [];
      expect(subSteps[0].title).toBe('Pilot: Logged-in indicator visible');
      const urlStep = subSteps.find((s) => s.title.startsWith('Navigated to'));
      expect(urlStep?.title).toBe('Navigated to Dashboard');
      expect(urlStep?.log).toBe('https://example.com/dashboard');
      expect(subSteps.some((s) => s.title.includes('💡 UX'))).toBe(true);
    });

    test('falls back to lastScreenshotFile when verification has no screenshot', () => {
      const reporter = new TestableReporter();
      const test = new Test('Sign in', 'high', ['Logged in'], 'https://example.com/login');
      test.setVerification('Pilot: ok', TestResult.PASSED);

      const steps = reporter.combineStepsAndNotes(test, 'fallback.png');
      const last = steps[steps.length - 1];
      expect(last.title).toBe('Verification');
      expect(last.artifacts?.[0]).toContain('fallback.png');
    });

    test('addUrlNote uses title when title changed', () => {
      const reporter = new TestableReporter();
      const test = new Test('Browse', 'high', ['Pages opened'], 'https://example.com/');

      test.addUrlNote({ url: '/products', fullUrl: 'https://example.com/products', title: 'Products', h1: 'All products', screenshotFile: 'p.png' }, { title: 'Home', h1: 'Welcome' });

      const steps = reporter.combineStepsAndNotes(test);
      const userStep = steps.find((s) => s.title === 'Navigated to Products');
      expect(userStep).toBeDefined();
      expect(userStep?.log).toBe('https://example.com/products');
      expect(userStep?.artifacts?.[0]).toContain('p.png');
    });

    test('addUrlNote falls back to h1 when title unchanged', () => {
      const reporter = new TestableReporter();
      const test = new Test('Browse', 'high', ['Pages opened'], 'https://example.com/');

      test.addUrlNote({ url: '/products/42', fullUrl: 'https://example.com/products/42', title: 'Shop', h1: 'Widget 42' }, { title: 'Shop', h1: 'Catalog' });

      const steps = reporter.combineStepsAndNotes(test);
      const userStep = steps.find((s) => s.title === 'Navigated to Widget 42');
      expect(userStep).toBeDefined();
      expect(userStep?.log).toBe('https://example.com/products/42');
    });

    test('addUrlNote falls back to h2 when title and h1 unchanged but h2 changed', () => {
      const reporter = new TestableReporter();
      const test = new Test('Browse', 'high', ['Pages opened'], 'https://example.com/');

      test.addUrlNote({ url: '/products/42', fullUrl: 'https://example.com/products/42', title: 'Shop', h1: 'Catalog', h2: 'Widget 42' }, { title: 'Shop', h1: 'Catalog', h2: 'Catalog overview' });

      const steps = reporter.combineStepsAndNotes(test);
      const userStep = steps.find((s) => s.title === 'Navigated to Widget 42');
      expect(userStep).toBeDefined();
      expect(userStep?.log).toBe('https://example.com/products/42');
    });

    test('addUrlNote keeps existing title when nothing changed (never inlines URL into title)', () => {
      const reporter = new TestableReporter();
      const test = new Test('Browse', 'high', ['Pages opened'], 'https://example.com/');

      test.addUrlNote({ url: '/products?p=2', fullUrl: 'https://example.com/products?p=2', title: 'Shop', h1: 'Catalog' }, { title: 'Shop', h1: 'Catalog' });

      const steps = reporter.combineStepsAndNotes(test);
      const userStep = steps.find((s) => s.title === 'Navigated to Shop');
      expect(userStep).toBeDefined();
      expect(userStep?.log).toBe('https://example.com/products?p=2');
      expect(userStep?.title).not.toContain('https://');
    });

    test('addUrlNote skips note when no descriptive label exists at all', () => {
      const reporter = new TestableReporter();
      const test = new Test('Browse', 'high', ['Pages opened'], 'https://example.com/');

      test.addUrlNote({ url: '/x', fullUrl: 'https://example.com/x' });

      const steps = reporter.combineStepsAndNotes(test);
      expect(steps.find((s) => (s.title || '').startsWith('Navigated to'))).toBeUndefined();
    });

    test('addUrlNote does not dedupe when same label has different URLs', () => {
      const reporter = new TestableReporter();
      const test = new Test('Browse', 'high', ['Pages opened'], 'https://example.com/');

      test.addUrlNote({ url: '/a', fullUrl: 'https://example.com/a', title: 'Detail' });
      test.addUrlNote({ url: '/b', fullUrl: 'https://example.com/b', title: 'Detail' }, { title: 'Detail' });

      const steps = reporter.combineStepsAndNotes(test);
      const navSteps = steps.filter((s) => s.title === 'Navigated to Detail');
      expect(navSteps.length).toBe(2);
      expect(navSteps[0].log).toBe('https://example.com/a');
      expect(navSteps[1].log).toBe('https://example.com/b');
    });

    test('no Verification step when test never set one (legacy lastScreenshotFile path still works)', () => {
      const reporter = new TestableReporter();
      const test = new Test('Sign in', 'high', ['Logged in'], 'https://example.com/login');

      const note = test.startNote('Click login');
      test.addStep('I.click("Login")', 10, 'passed');
      note.commit(TestResult.PASSED);

      const steps = reporter.combineStepsAndNotes(test, 'last.png');
      expect(steps.find((s) => s.title === 'Verification')).toBeUndefined();
      expect(steps[steps.length - 1].artifacts?.some((a) => a.includes('last.png'))).toBe(true);
    });
  });
});

describe('Reporter config', () => {
  let savedTestomatio: string | undefined;
  let savedHtmlSave: string | undefined;
  let savedHtmlFolder: string | undefined;
  let savedHtmlFilename: string | undefined;
  let savedMarkdownSave: string | undefined;
  let savedMarkdownFolder: string | undefined;
  let savedMarkdownFilename: string | undefined;
  let savedRunGroup: string | undefined;

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
    savedHtmlFilename = process.env.TESTOMATIO_HTML_FILENAME;
    savedMarkdownSave = process.env.TESTOMATIO_MARKDOWN_REPORT_SAVE;
    savedMarkdownFolder = process.env.TESTOMATIO_MARKDOWN_REPORT_FOLDER;
    savedMarkdownFilename = process.env.TESTOMATIO_MARKDOWN_FILENAME;
    savedRunGroup = process.env.TESTOMATIO_RUNGROUP_TITLE;
    clearEnv('TESTOMATIO');
    clearEnv('TESTOMATIO_HTML_REPORT_SAVE');
    clearEnv('TESTOMATIO_HTML_REPORT_FOLDER');
    clearEnv('TESTOMATIO_HTML_FILENAME');
    clearEnv('TESTOMATIO_MARKDOWN_REPORT_SAVE');
    clearEnv('TESTOMATIO_MARKDOWN_REPORT_FOLDER');
    clearEnv('TESTOMATIO_MARKDOWN_FILENAME');
    clearEnv('TESTOMATIO_RUNGROUP_TITLE');
  });

  afterEach(() => {
    restoreEnv('TESTOMATIO', savedTestomatio);
    restoreEnv('TESTOMATIO_HTML_REPORT_SAVE', savedHtmlSave);
    restoreEnv('TESTOMATIO_HTML_REPORT_FOLDER', savedHtmlFolder);
    restoreEnv('TESTOMATIO_HTML_FILENAME', savedHtmlFilename);
    restoreEnv('TESTOMATIO_MARKDOWN_REPORT_SAVE', savedMarkdownSave);
    restoreEnv('TESTOMATIO_MARKDOWN_REPORT_FOLDER', savedMarkdownFolder);
    restoreEnv('TESTOMATIO_MARKDOWN_FILENAME', savedMarkdownFilename);
    restoreEnv('TESTOMATIO_RUNGROUP_TITLE', savedRunGroup);
  });

  test('enabled: true without TESTOMATIO sets HTML report env vars', () => {
    const reporter = new Reporter({ enabled: true });
    expect(process.env.TESTOMATIO_HTML_REPORT_SAVE).toBe('1');
    expect(process.env.TESTOMATIO_HTML_REPORT_FOLDER).toContain('reports');
    expect(process.env.TESTOMATIO_HTML_FILENAME).toBe(`${Stats.sessionLabel()}.html`);
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

  test('markdown: true sets markdown env vars', () => {
    const reporter = new Reporter({ enabled: true, markdown: true });
    expect(process.env.TESTOMATIO_MARKDOWN_REPORT_SAVE).toBe('1');
    expect(process.env.TESTOMATIO_MARKDOWN_REPORT_FOLDER).toContain('reports');
    expect(process.env.TESTOMATIO_MARKDOWN_FILENAME).toBe(`${Stats.sessionLabel()}-tests.md`);
  });

  test('markdown: true with TESTOMATIO also sets markdown env vars', () => {
    process.env.TESTOMATIO = 'tstmt_test_key';
    const reporter = new Reporter({ enabled: true, markdown: true });
    expect(process.env.TESTOMATIO_MARKDOWN_REPORT_SAVE).toBe('1');
    expect(process.env.TESTOMATIO_MARKDOWN_REPORT_FOLDER).toContain('reports');
  });

  test('markdown unset does not set markdown env vars', () => {
    const reporter = new Reporter({ enabled: true });
    expect(process.env.TESTOMATIO_MARKDOWN_REPORT_SAVE).toBeUndefined();
  });

  test('enabled: false with markdown: true does not set markdown env vars', () => {
    const reporter = new Reporter({ enabled: false, markdown: true });
    expect(process.env.TESTOMATIO_MARKDOWN_REPORT_SAVE).toBeUndefined();
  });

  test('runGroup defaults to "Explorbot YYYY-MM-DD" when enabled', () => {
    const reporter = new Reporter({ enabled: true });
    const today = new Date().toISOString().slice(0, 10);
    expect(process.env.TESTOMATIO_RUNGROUP_TITLE).toBe(`Explorbot ${today}`);
  });

  test('runGroup string overrides default', () => {
    const reporter = new Reporter({ enabled: true, runGroup: 'Smoke Suite' });
    expect(process.env.TESTOMATIO_RUNGROUP_TITLE).toBe('Smoke Suite');
  });

  test('runGroup: null disables the run group', () => {
    const reporter = new Reporter({ enabled: true, runGroup: null });
    expect(process.env.TESTOMATIO_RUNGROUP_TITLE).toBeUndefined();
  });

  test('pre-set TESTOMATIO_RUNGROUP_TITLE env wins over default', () => {
    process.env.TESTOMATIO_RUNGROUP_TITLE = 'Nightly';
    const reporter = new Reporter({ enabled: true });
    expect(process.env.TESTOMATIO_RUNGROUP_TITLE).toBe('Nightly');
  });

  test('runGroup not set when reporter disabled', () => {
    const reporter = new Reporter({ enabled: false });
    expect(process.env.TESTOMATIO_RUNGROUP_TITLE).toBeUndefined();
  });

  test('writes finished Explorbot test into HTML report', async () => {
    const outputDir = ConfigParser.getInstance().getOutputDir();
    rmSync(join(outputDir, 'reports'), { recursive: true, force: true });

    const reporter = new Reporter({ enabled: true, html: true });
    const test = new Test('Verify sign in page is visible', 'normal', ['Sign In is visible'], 'https://example.com/users/sign_in');
    test.start();
    test.addNote('Sign In is visible', TestResult.PASSED);
    test.addStep('I.see("Sign In", "h2")', 10, 'passed');
    test.finish(TestResult.PASSED);

    await reporter.reportTestStart(test);
    await reporter.reportTest(test);
    await reporter.finishRun();

    const reportFile = join(outputDir, 'reports', `${Stats.sessionLabel()}.html`);
    expect(existsSync(reportFile)).toBe(true);
    expect(readFileSync(reportFile, 'utf8')).toContain('Verify sign in page is visible');
  });
});
