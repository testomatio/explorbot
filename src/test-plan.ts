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
  startTime: number;
  endTime: number;
}

export class ActiveNote {
  private task: Task;
  startTime: number;
  message: string;
  status?: TestResultType;

  constructor(task: Task, message: string, status?: TestResultType) {
    this.task = task;
    this.startTime = performance.now();
    this.message = message;
    this.status = status;
  }

  commit(finalStatus?: TestResultType): void {
    const endTime = performance.now();
    this.task.finishNote(this, endTime, finalStatus);
  }

  getMessage(): string {
    return this.message;
  }

  getStartTime(): number {
    return this.startTime;
  }
}

export interface StepData {
  text: string;
  duration?: number;
  status?: string;
  error?: string;
  log?: string;
  noteStartTime?: number;
}

export class Task {
  id: string;
  description: string;
  notes: Record<string, Note>;
  steps: Record<string, StepData>;
  states: WebPageState[];
  startUrl: string;
  protected timestampCounter = 0;
  private activeNote?: ActiveNote;

  constructor(description: string, startUrl = '') {
    this.id = `${createHash('md5').update(description).digest('hex').slice(0, 8)}_${Date.now().toString(36)}`;
    this.description = description;
    this.notes = {};
    this.steps = {};
    this.states = [];
    this.startUrl = startUrl;
  }

  startNote(message: string, status?: TestResultType): ActiveNote {
    if (this.activeNote) {
      this.activeNote.commit();
    }
    const note = new ActiveNote(this, message, status);
    this.activeNote = note;
    return note;
  }

  finishNote(activeNote: ActiveNote, endTime: number, finalStatus?: TestResultType): void {
    const timestamp = `${activeNote.getStartTime()}_${this.timestampCounter++}`;
    this.notes[timestamp] = {
      message: activeNote.getMessage(),
      status: finalStatus || activeNote.status,
      startTime: activeNote.getStartTime(),
      endTime,
    };
    this.activeNote = undefined;
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

    const now = performance.now();
    const timestamp = `${now}_${this.timestampCounter++}`;
    this.notes[timestamp] = { message, status, startTime: now, endTime: now };
  }

  addState(state: WebPageState): void {
    this.states.push(state);
  }

  addStep(text: string, duration?: number, status?: string, error?: string, log?: string): void {
    const timestamp = `${performance.now()}_${this.timestampCounter++}`;
    this.steps[timestamp] = { text, duration, status, error, log, noteStartTime: this.activeNote?.getStartTime() };
  }

  getLog(): Array<{ type: 'step' | 'note' | 'artifact'; content: string; timestamp: number }> {
    const merged: Record<string, { type: 'step' | 'note' | 'artifact'; content: string }> = {};

    for (const [key, stepData] of Object.entries(this.steps)) {
      merged[key] = { type: 'step', content: stepData.text };
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
      .map((item) => `${item.type === 'step' ? '  ' : ''}${item.content}`)
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
  generatedCode?: string;
  planIteration = 0;

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

  addArtifact(artifact?: string): void {
    if (!artifact) return;
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
    this.addNote('Test started. Session name: ' + this.sessionName);
    this.plan?.notifyChange();
  }

  finish(result: TestResultType = TestResult.FAILED): void {
    this.status = TestStatus.DONE;
    this.result = result;
    this.plan?.notifyChange();
  }

  getRemainingExpectations(): string[] {
    const achieved = this.getCheckedExpectations();
    return this.expected.filter((e) => !achieved.includes(e));
  }

  override getLog(): Array<{ type: 'step' | 'note' | 'artifact'; content: string; timestamp: number }> {
    const merged: Record<string, { type: 'step' | 'note' | 'artifact'; content: string }> = {};

    for (const [key, stepData] of Object.entries(this.steps)) {
      merged[key] = { type: 'step', content: stepData.text };
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

type PlanChangeListener = (tests: Test[]) => void;

export class Plan {
  title: string;
  tests: Test[] = [];
  url?: string;
  iteration = 0;
  private changeListeners: PlanChangeListener[] = [];

  constructor(title: string) {
    this.title = title;
    if (title.startsWith('/')) this.url = title;
  }

  nextIteration(): void {
    this.iteration++;
  }

  addTest(test: Test): void {
    test.plan = this;
    test.planIteration = this.iteration;
    this.tests.push(test);
    this.notifyChange();
  }

  onTestsChange(listener: PlanChangeListener): () => void {
    this.changeListeners.push(listener);
    return () => {
      const index = this.changeListeners.indexOf(listener);
      if (index > -1) this.changeListeners.splice(index, 1);
    };
  }

  notifyChange(): void {
    for (const listener of this.changeListeners) {
      listener(this.tests);
    }
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
