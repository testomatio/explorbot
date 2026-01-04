import { createHash } from 'node:crypto';
import figures from 'figures';
import { WebPageState } from './state-manager.ts';
import { parsePlanFromMarkdown, planToAiContext, savePlanToMarkdown } from './utils/test-plan-markdown.ts';
import { uniqSessionName } from './utils/unique-names.ts';

export const TestResult = {
  PASSED: 'passed',
  FAILED: 'failed',
} as const;

export type TestResultType = (typeof TestResult)[keyof typeof TestResult] | null;

export const TestStatus = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  DONE: 'done',
} as const;

export type TestStatusType = (typeof TestStatus)[keyof typeof TestStatus];

export interface Note {
  message: string;
  status?: TestResultType;
  step?: boolean;
}

export class Task {
  id: string;
  description: string;
  notes: Record<string, Note>;
  steps: Record<string, string>;
  states: WebPageState[];
  startUrl: string;
  protected timestampCounter = 0;

  constructor(description: string, startUrl = '') {
    this.id = `${createHash('md5').update(description).digest('hex').slice(0, 8)}_${Date.now().toString(36)}`;
    this.description = description;
    this.notes = {};
    this.steps = {};
    this.states = [];
    this.startUrl = startUrl;
  }

  getPrintableNotes(): string[] {
    return Object.values(this.notes).map((n) => {
      return `${n.status?.toUpperCase() || ''} ${n.message}`.trim();
    });
  }

  notesToString(): string {
    return this.getPrintableNotes()
      .map((n) => `- ${n}`)
      .join('\n');
  }

  addNote(message: string, status: TestResultType = null): void {
    const isDuplicate = Object.values(this.notes).some((note) => note.message === message && note.status === status);
    if (isDuplicate) return;

    const timestamp = `${performance.now()}_${this.timestampCounter++}`;
    this.notes[timestamp] = { message, status };
  }

  addState(state: WebPageState): void {
    this.states.push(state);
  }

  addStep(text: string): void {
    const timestamp = `${performance.now()}_${this.timestampCounter++}`;
    this.steps[timestamp] = text;
  }

  getLog(): Array<{ type: 'step' | 'note'; content: string; timestamp: number }> {
    const merged: Record<string, { type: 'step' | 'note'; content: string }> = {};

    for (const [key, text] of Object.entries(this.steps)) {
      merged[key] = { type: 'step', content: text };
    }

    for (const [key, note] of Object.entries(this.notes)) {
      merged[key] = { type: 'note', content: note.message };
    }

    return Object.entries(merged)
      .map(([timestampKey, item]) => ({
        ...item,
        timestamp: Number.parseFloat(timestampKey.split('_')[0]),
      }))
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  getLogString(): string {
    return this.getLog()
      .map((item) => (item.type === 'step' ? '  ' : '') + `${item.content}`)
      .join('\n');
  }
}

export class Test extends Task {
  scenario: string;
  sessionName?: string;
  status: TestStatusType;
  result: TestResultType;
  priority: 'high' | 'medium' | 'low' | 'unknown';
  expected: string[];
  plannedSteps: string[];
  plan?: Plan;
  summary: string;
  artifacts: Record<string, string>;

  constructor(scenario: string, priority: 'high' | 'medium' | 'low' | 'unknown', expectedOutcome: string | string[], startUrl: string, plannedSteps: string[] = []) {
    super(scenario, startUrl);
    this.scenario = scenario;
    this.status = TestStatus.PENDING;
    this.result = null;
    this.sessionName = uniqSessionName();
    this.priority = priority;
    this.expected = Array.isArray(expectedOutcome) ? expectedOutcome : [expectedOutcome];
    this.plannedSteps = plannedSteps;
    this.artifacts = {};
    this.summary = '';
  }

  getVisitedUrls({ localOnly = false }: { localOnly?: boolean } = {}): string[] {
    if (this.plan && !localOnly) {
      return this.plan.tests.flatMap((t) => t.getVisitedUrls({ localOnly: true }));
    }
    return [...new Set([this.startUrl, ...this.states.map((s) => s.url)].filter((value): value is string => Boolean(value) && value.trim() !== ''))];
  }

  addArtifact(artifact: string): void {
    const timestamp = `${performance.now()}_${this.timestampCounter++}`;
    this.artifacts[timestamp] = artifact;
  }

  get hasFinished(): boolean {
    return this.status === TestStatus.DONE || this.isComplete();
  }

  get isSuccessful(): boolean {
    return this.hasFinished && this.result === TestResult.PASSED;
  }

  get hasFailed(): boolean {
    return this.hasFinished && this.result === TestResult.FAILED;
  }

  getCheckedNotes(): Note[] {
    return Object.values(this.notes).filter((n) => !!n.status);
  }

  getCheckedExpectations(): string[] {
    return this.expected.filter((expectation) => {
      return Object.values(this.notes).some((note) => note.message === expectation && !!note.status);
    });
  }

  hasAchievedAny(): boolean {
    return this.expected.some((expectation) => {
      return Object.values(this.notes).some((note) => note.message === expectation && note.status === TestResult.PASSED);
    });
  }

  hasAchievedAll(): boolean {
    return this.expected.every((expectation) => {
      return Object.values(this.notes).some((note) => note.message === expectation && note.status === TestResult.PASSED);
    });
  }

  isComplete(): boolean {
    return this.expected.every((expectation) => {
      return Object.values(this.notes).some((note) => note.message === expectation && !!note.status);
    });
  }

  start(): void {
    this.status = TestStatus.IN_PROGRESS;
    this.addNote('Test started');
  }

  finish(result: TestResultType = TestResult.FAILED): void {
    this.status = TestStatus.DONE;
    this.result = result;
  }

  getRemainingExpectations(): string[] {
    const achieved = this.getCheckedExpectations();
    return this.expected.filter((e) => !achieved.includes(e));
  }

  override getLog(): Array<{ type: 'step' | 'note' | 'artifact'; content: string; timestamp: number }> {
    const merged: Record<string, { type: 'step' | 'note' | 'artifact'; content: string }> = {};

    for (const [key, text] of Object.entries(this.steps)) {
      merged[key] = { type: 'step', content: text };
    }

    for (const [key, note] of Object.entries(this.notes)) {
      merged[key] = { type: 'note', content: note.message };
    }

    for (const [key, artifact] of Object.entries(this.artifacts)) {
      merged[key] = { type: 'artifact', content: artifact };
    }

    return Object.entries(merged)
      .map(([timestampKey, item]) => ({
        ...item,
        timestamp: Number.parseFloat(timestampKey.split('_')[0]),
      }))
      .sort((a, b) => a.timestamp - b.timestamp);
  }
}

export class Plan {
  title: string;
  tests: Test[] = [];
  url?: string;

  constructor(title: string) {
    this.title = title;
    if (title.startsWith('/')) this.url = title;
  }

  addTest(test: Test): void {
    test.plan = this;
    this.tests.push(test);
  }

  listTests(): Test[] {
    return [...this.tests];
  }

  getPendingTests(): Test[] {
    return this.tests.filter((test) => test.status === 'pending');
  }

  get isComplete(): boolean {
    return this.tests.length > 0 && this.tests.every((test) => test.hasFinished);
  }

  get allSuccessful(): boolean {
    return this.tests.length > 0 && this.tests.every((test) => test.isSuccessful);
  }

  get allFailed(): boolean {
    return this.tests.length > 0 && this.tests.every((test) => test.hasFailed);
  }

  updateStatus(): void {}

  static fromMarkdown(filePath: string): Plan {
    return parsePlanFromMarkdown(filePath);
  }

  saveToMarkdown(filePath: string): void {
    savePlanToMarkdown(this, filePath);
  }

  getVisitedPages(): WebPageState[] {
    const visitedStates = this.tests.flatMap((test) => test.states).filter((state) => state.url !== this.url);
    const uniqueStates = new Map<string, WebPageState>();

    for (const state of visitedStates) {
      if (!uniqueStates.has(state.url)) {
        uniqueStates.set(state.url, state);
      }
    }

    return Array.from(uniqueStates.values());
  }

  merge(otherPlan: Plan): Plan {
    const mergedTitle = this.title && otherPlan.title ? `${this.title} + ${otherPlan.title}` : this.title || otherPlan.title || 'Merged Plan';

    const mergedUrl = this.url || otherPlan.url;

    const mergedTests = [...this.tests];

    // Add tests from other plan, avoiding duplicates based on scenario
    for (const otherTest of otherPlan.tests) {
      const isDuplicate = mergedTests.some((test) => test.scenario === otherTest.scenario && test.startUrl === otherTest.startUrl);

      if (!isDuplicate) {
        mergedTests.push(otherTest);
      }
    }

    const mergedPlan = new Plan(mergedTitle);
    for (const test of mergedTests) {
      mergedPlan.addTest(test);
    }
    if (mergedUrl) {
      mergedPlan.url = mergedUrl;
    }

    return mergedPlan;
  }

  toAiContext(): string {
    return planToAiContext(this);
  }
}
