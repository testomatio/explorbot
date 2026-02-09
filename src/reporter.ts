import { Client } from '@testomatio/reporter';
import type { Step } from '@testomatio/reporter/types/types.js';
import { Test } from './test-plan.js';
import { createDebug } from './utils/logger.js';

const debugLog = createDebug('explorbot:reporter');

export interface ReporterStep {
  title: string;
  status: 'passed' | 'failed';
  code: string[];
  discovery?: string;
}

export class Reporter {
  private client: Client;
  private isRunStarted = false;

  constructor() {
    this.client = new Client({ apiKey: process.env.TESTOMATIO || '' });
    debugLog('Testomat.io reporter initialized');
  }

  async startRun(): Promise<void> {
    if (this.isRunStarted) {
      return;
    }

    if (!process.env.TESTOMATIO) {
      return;
    }

    try {
      const timeoutMs = Number(process.env.TESTOMATIO_TIMEOUT_MS || '15000');
      const timeoutPromise = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), timeoutMs));

      const result = await Promise.race([this.client.createRun().then(() => 'success' as const), timeoutPromise]);

      if (result === 'timeout') {
        debugLog('Testomat.io run creation timed out');
        return;
      }

      if (!this.client.runId) {
        debugLog('Testomat.io run creation failed - no runId received');
        return;
      }

      this.isRunStarted = true;
      debugLog('Testomat.io run started with ID:', this.client.runId);
    } catch (error) {
      debugLog('Failed to start Testomat.io reporter:', error);
      return;
    }

    process.env.TESTOMATIO_STACK_PASSED = 'true';
    process.env.TESTOMATIO_STEPS_PASSED = 'true';
  }

  async reportTestStart(test: Test): Promise<void> {
    await this.startRun();

    if (!this.isRunStarted) {
      return;
    }

    try {
      const testData = {
        rid: test.id,
        title: test.scenario,
        suite_title: test.plan?.title || 'Auto-Exploratory Testing',
      };

      debugLog('Test started:', testData);
      await this.client.addTestRun(null, testData);
      debugLog(`Test reported as pending: ${test.scenario}`);
    } catch (error) {
      debugLog('Failed to report test start:', error);
    }
  }

  protected combineStepsAndNotes(test: Test): Step[] {
    const noteEntries = Object.entries(test.notes)
      .map(([timestampKey, note]) => ({
        startTime: note.startTime,
        message: note.message,
        status: note.status,
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

      steps.push({
        category: 'user',
        title: noteEntry.message,
        duration: 0,
        steps: noteSteps.length > 0 ? noteSteps : undefined,
      });
    }

    return steps;
  }

  async reportTest(test: Test): Promise<void> {
    await this.startRun();

    if (!this.isRunStarted) {
      return;
    }

    try {
      let status = null;
      if (test.isSuccessful) {
        status = 'passed';
      } else if (test.hasFailed) {
        status = 'failed';
      }

      const steps = this.combineStepsAndNotes(test);

      const testData = {
        rid: test.id,
        title: test.scenario,
        suite_title: test.plan?.title || 'Auto-Exploratory Testing',
        steps,
        logs: Object.values(test.steps)
          .map((stepData) => stepData.text)
          .join('\n'),
        files: Object.values(test.artifacts) || [],
        message: test.summary || '',
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

  async reportSteps(test: Test, steps: ReporterStep[]): Promise<void> {
    if (!this.isRunStarted) return;

    const formattedSteps: Step[] = steps.map((step) => ({
      category: 'user',
      title: step.title,
      duration: 0,
      steps: step.code.map((code) => ({
        category: 'framework',
        title: code,
        duration: 0,
      })),
    }));

    const discoveries = steps
      .filter((s) => s.discovery)
      .map((s) => s.discovery)
      .join('\n');

    try {
      const testData = {
        rid: test.id,
        title: test.scenario,
        suite_title: test.plan?.title || 'Auto-Exploratory Testing',
        steps: formattedSteps,
        message: discoveries || test.summary || '',
      };

      debugLog('Reporting steps:', testData);
      await this.client.addTestRun(null, testData);
    } catch (error) {
      debugLog('Failed to report steps:', error);
    }
  }
}
