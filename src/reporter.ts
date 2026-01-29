import { Client } from '@testomatio/reporter';
import type { Step } from '@testomatio/reporter/types/types.js';
import { Test } from './test-plan.js';
import { createDebug } from './utils/logger.js';

const debugLog = createDebug('explorbot:reporter');

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
      await Promise.race([this.client.createRun(), new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
      this.isRunStarted = true;
      debugLog('Testomat.io run started');
    } catch (error) {
      debugLog('Failed to start Testomat.io reporter:', error);
    }

    process.env.TESTOMATIO_STACK_PASSED = 'true';
    process.env.TESTOMATIO_STEPS_PASSED = 'true';
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
}
