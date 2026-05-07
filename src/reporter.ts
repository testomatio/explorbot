import { join } from 'node:path';
import { Client } from '@testomatio/reporter';
import type { Step } from '@testomatio/reporter/types/types.js';
import { ConfigParser, outputPath } from './config.js';
import type { ReporterConfig } from './config.js';
import type { StateManager } from './state-manager.js';
import { Stats } from './stats.js';
import { Test } from './test-plan.js';
import { createDebug } from './utils/logger.js';

export type ReporterMeta = Record<string, string | undefined>;

const debugLog = createDebug('explorbot:reporter');

export interface ReporterStep {
  title: string;
  status: 'passed' | 'failed';
  code: string[];
  discovery?: string;
}

export class Reporter {
  private client!: Client;
  private isRunStarted = false;
  private reporterEnabled: boolean;
  private stateManager?: StateManager;

  constructor(config?: ReporterConfig, stateManager?: StateManager) {
    this.reporterEnabled = Reporter.resolveEnabled(config);
    this.stateManager = stateManager;

    if (this.reporterEnabled && (!process.env.TESTOMATIO || config?.html)) {
      this.configureHtmlPipe();
    }

    if (this.reporterEnabled && config?.markdown) {
      this.configureMarkdownPipe();
    }

    if (this.reporterEnabled) {
      this.configureRunGroup(config?.runGroup);
    }

    debugLog('Reporter initialized', {
      enabled: this.reporterEnabled,
      testomatio: Boolean(process.env.TESTOMATIO),
      html: Boolean(process.env.TESTOMATIO_HTML_REPORT_SAVE),
      markdown: Boolean(process.env.TESTOMATIO_MARKDOWN_REPORT_SAVE),
      runGroup: process.env.TESTOMATIO_RUNGROUP_TITLE || null,
    });
  }

  private buildTitle(): string {
    if (process.env.TESTOMATIO_TITLE) return process.env.TESTOMATIO_TITLE;
    const url = this.stateManager?.getCurrentState()?.url;
    const parts = ['Explorbot session'];
    if (url) parts.push(url);
    if (Stats.focus) parts.push(`focus: "${Stats.focus}"`);
    parts.push(`at ${new Date().toISOString().slice(0, 16)}`);
    return parts.join(' ');
  }

  static resolveEnabled(config?: ReporterConfig): boolean {
    if (config?.enabled === true) return true;
    if (config?.enabled === false) return false;
    return Boolean(process.env.TESTOMATIO);
  }

  private configureHtmlPipe(): void {
    process.env.TESTOMATIO_HTML_REPORT_SAVE = '1';
    process.env.TESTOMATIO_HTML_REPORT_FOLDER = outputPath('reports');
    process.env.TESTOMATIO_HTML_FILENAME = `${Stats.sessionLabel()}.html`;
    debugLog('HTML report pipe configured', {
      folder: process.env.TESTOMATIO_HTML_REPORT_FOLDER,
      filename: process.env.TESTOMATIO_HTML_FILENAME,
    });
  }

  private configureMarkdownPipe(): void {
    process.env.TESTOMATIO_MARKDOWN_REPORT_SAVE = '1';
    process.env.TESTOMATIO_MARKDOWN_REPORT_FOLDER = outputPath('reports');
    process.env.TESTOMATIO_MARKDOWN_FILENAME = `${Stats.sessionLabel()}-tests.md`;
    debugLog('Markdown report pipe configured', {
      folder: process.env.TESTOMATIO_MARKDOWN_REPORT_FOLDER,
      filename: process.env.TESTOMATIO_MARKDOWN_FILENAME,
    });
  }

  private configureRunGroup(runGroup: string | null | undefined): void {
    if (process.env.TESTOMATIO_RUNGROUP_TITLE) return;
    if (runGroup === null) return;
    if (runGroup) {
      process.env.TESTOMATIO_RUNGROUP_TITLE = runGroup;
      return;
    }
    process.env.TESTOMATIO_RUNGROUP_TITLE = `Explorbot ${new Date().toISOString().slice(0, 10)}`;
  }

  async startRun(): Promise<void> {
    if (this.isRunStarted) {
      return;
    }

    if (!this.reporterEnabled) {
      return;
    }

    try {
      this.client = new Client({ apiKey: process.env.TESTOMATIO || '', title: this.buildTitle() });
      const timeoutMs = Number(process.env.TESTOMATIO_TIMEOUT_MS || '15000');
      const timeoutPromise = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), timeoutMs));

      const result = await Promise.race([this.client.createRun({ configuration: { exploratory: true } }).then(() => 'success' as const), timeoutPromise]);

      if (result === 'timeout') {
        debugLog('Reporter run creation timed out');
        return;
      }

      if (process.env.TESTOMATIO && !this.client.runId) {
        debugLog('Testomat.io run creation failed - no runId received');
        return;
      }

      this.isRunStarted = true;
      debugLog('Reporter run started', { runId: this.client.runId || 'html-only' });
    } catch (error) {
      debugLog('Failed to start reporter:', error);
      return;
    }

    process.env.TESTOMATIO_STACK_PASSED = 'true';
    process.env.TESTOMATIO_STEPS_PASSED = 'true';
  }

  async reportTestStart(test: Test): Promise<void> {
    await this.startRun();
  }

  protected combineStepsAndNotes(test: Test, lastScreenshotFile?: string): Step[] {
    const noteEntries = Object.entries(test.notes)
      .map(([timestampKey, note]) => ({
        startTime: note.startTime,
        endTime: note.endTime,
        message: note.message,
        status: note.status,
        screenshot: note.screenshot,
        log: note.log,
      }))
      .sort((a, b) => a.startTime - b.startTime);

    const stepEntries = Object.entries(test.steps)
      .map(([timestampKey, stepData]) => ({
        noteStartTime: stepData.noteStartTime,
        text: stepData.text,
        duration: stepData.duration,
        error: stepData.error,
        log: stepData.log,
      }))
      .filter((step) => step.noteStartTime !== undefined);

    const steps: Step[] = [];

    for (const noteEntry of noteEntries) {
      const noteSteps = stepEntries
        .filter((step) => step.noteStartTime === noteEntry.startTime)
        .map((entry) => ({
          category: 'framework',
          title: entry.text,
          duration: entry.duration ?? 0,
          ...Object.fromEntries(Object.entries(entry).filter(([k]) => k !== 'noteStartTime' && k !== 'text' && k !== 'duration')),
        }));

      const step: Step = {
        category: 'user',
        title: noteEntry.message,
        duration: Math.max(0, Math.round(noteEntry.endTime - noteEntry.startTime)),
        status: noteEntry.status || 'none',
        steps: noteSteps.length > 0 ? noteSteps : undefined,
      };
      if (noteEntry.screenshot) {
        step.artifacts = [outputPath('states', noteEntry.screenshot)];
      }
      if (noteEntry.log) {
        step.log = noteEntry.log;
      }
      steps.push(step);
    }

    const verificationStep = this.buildVerificationStep(test, lastScreenshotFile);
    if (verificationStep) {
      steps.push(verificationStep);
      return steps;
    }

    if (lastScreenshotFile && steps.length > 0) {
      const lastStep = steps[steps.length - 1];
      const screenshotPath = outputPath('states', lastScreenshotFile);
      if (lastStep.artifacts) {
        lastStep.artifacts.push(screenshotPath);
      } else {
        lastStep.artifacts = [screenshotPath];
      }
    }

    return steps;
  }

  private buildVerificationStep(test: Test, lastScreenshotFile?: string): Step | undefined {
    const v = test.verification;
    if (!v) return undefined;

    const subSteps: Step[] = [];
    if (v.message) subSteps.push({ category: 'framework', title: v.message, duration: 0 });
    if (v.url) {
      subSteps.push({
        category: 'framework',
        title: v.pageLabel ? `Navigated to ${v.pageLabel}` : 'Final page',
        log: v.url,
        duration: 0,
      });
    }
    for (const detail of v.details) {
      subSteps.push({ category: 'framework', title: detail, duration: 0 });
    }

    const screenshotFile = v.screenshot || lastScreenshotFile;

    const step: Step = {
      category: 'user',
      title: 'Verification',
      duration: 0,
      status: v.status || 'none',
      steps: subSteps.length > 0 ? subSteps : undefined,
    };
    if (screenshotFile) {
      step.artifacts = [outputPath('states', screenshotFile)];
    }
    return step;
  }

  async reportTest(test: Test, meta?: ReporterMeta): Promise<void> {
    await this.startRun();

    if (!this.isRunStarted) {
      return;
    }

    try {
      let status = null;
      if (test.isSuccessful) {
        status = 'passed';
      } else if (test.isSkipped) {
        status = 'skipped';
      } else if (test.hasFailed) {
        status = 'failed';
      }

      const screenshotFile = meta?.screenshotFile;
      if (meta) {
        meta.screenshotFile = undefined;
        meta = Object.fromEntries(Object.entries(meta).filter(([, v]) => v));
      }

      const steps = this.combineStepsAndNotes(test, screenshotFile);
      const durationMs = test.getDurationMs();

      const testData = {
        rid: test.id,
        title: test.scenario,
        suite_title: test.plan?.title || 'Auto-Exploratory Testing',
        file: '<note>',
        description: test.description,
        code: test.generatedCode || '',
        steps,
        logs: Object.values(test.steps)
          .map((stepData) => stepData.text)
          .join('\n'),
        files: Object.values(test.artifacts) || [],
        message: test.summary || this.extractLastNoteMessage(test) || '',
        meta,
        time: durationMs != null ? Math.round(durationMs) : 0,
      };

      debugLog(testData);

      await this.client.addTestRun(status, testData);
      debugLog(`Test reported: ${test.scenario} - ${status}`);
    } catch (error) {
      debugLog('Failed to report test:', error);
    }
  }

  async finishRun(): Promise<void> {
    if (!this.isRunStarted) {
      return;
    }

    try {
      await this.client.updateRunStatus('finished');
      this.isRunStarted = false;
      debugLog('Testomat.io run finished');
    } catch (error) {
      debugLog('Failed to finish Testomat.io run:', error);
    }
  }

  isEnabled(): boolean {
    return this.isRunStarted;
  }

  async setRunDescription(text: string): Promise<void> {
    if (!this.isRunStarted) return;
    if (!process.env.TESTOMATIO) return;
    const runId = this.client.runId;
    if (!runId) return;

    const baseUrl = process.env.TESTOMATIO_URL || 'https://app.testomat.io';
    const url = `${baseUrl}/api/reporter/${runId}`;
    try {
      const response = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: process.env.TESTOMATIO, description: text }),
      });
      if (!response.ok) {
        debugLog('Run description update failed:', response.status, response.statusText);
        return;
      }
      debugLog('Run description updated');
    } catch (error) {
      debugLog('Failed to update run description:', error);
    }
  }

  private extractLastNoteMessage(test: Test): string {
    const notes = Object.values(test.notes);
    if (notes.length === 0) return '';
    return notes[notes.length - 1].message;
  }

  async reportSteps(test: Test, steps: ReporterStep[]): Promise<void> {
    return;
  }
}
