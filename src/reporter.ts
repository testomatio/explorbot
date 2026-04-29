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

    const pipe = process.env.TESTOMATIO && config?.html ? 'both' : process.env.TESTOMATIO ? 'testomatio' : 'html';
    debugLog('Reporter initialized', { enabled: this.reporterEnabled, pipe });
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
    debugLog('HTML report pipe configured', { folder: process.env.TESTOMATIO_HTML_REPORT_FOLDER });
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

      const result = await Promise.race([this.client.createRun().then(() => 'success' as const), timeoutPromise]);

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
      steps.push(step);
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

  private extractLastNoteMessage(test: Test): string {
    const notes = Object.values(test.notes);
    if (notes.length === 0) return '';
    return notes[notes.length - 1].message;
  }

  async reportSteps(test: Test, steps: ReporterStep[]): Promise<void> {
    return;
  }
}
