import { Client } from '@testomatio/reporter';
import { createDebug, log } from './utils/logger.js';
import { Test } from './test-plan.js';
import type { Step } from '@testomatio/reporter/types/types.js';

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

    try {
      await this.client.createRun();
      this.isRunStarted = true;
      debugLog('Testomat.io run started');
    } catch (error) {
      debugLog('Failed to start Testomat.io reporter:', error);
    }

    process.env.TESTOMATIO_STACK_PASSED = 'true';
    process.env.TESTOMATIO_STEPS_PASSED = 'true';
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

      const steps: Step[] = test.getPrintableNotes().map((note) => ({
        category: 'user',
        title: note,
        duration: 1,
      }));

      const testData = {
        rid: test.id,
        title: test.scenario,
        suite_title: test.plan?.title || 'Auto-Exploratory Testing',
        steps,
        stack: Object.values(test.steps).join('\n'),
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
