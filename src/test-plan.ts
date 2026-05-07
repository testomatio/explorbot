import { createHash } from 'node:crypto';
import figures from 'figures';
import { WebPageState } from './state-manager.ts';
import { parsePlanFromMarkdown, planToAiContext, savePlanToMarkdown, savePlansToMarkdown } from './utils/test-plan-markdown.ts';
import { uniqSessionName } from './utils/unique-names.ts';

export const TestResult = {
  PASSED: 'passed',
  FAILED: 'failed',
  SKIPPED: 'skipped',
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
  screenshot?: string;
  log?: string;
}

export class ActiveNote {
  private task: Task;
  startTime: number;
  message: string;
  status?: TestResultType;
  screenshot?: string;
  log?: string;

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
  artifacts?: string[];
  noteStartTime?: number;
}

export class Task {
  id: string;
  description: string;
  notes: Record<string, Note>;
  steps: Record<string, StepData>;
  states: WebPageState[];
  startUrl: string;
  verification?: Verification;
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
      screenshot: activeNote.screenshot,
      log: activeNote.log,
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

  addNote(message: string, status: TestResultType = null, screenshot?: string, log?: string): void {
    const isDuplicate = Object.values(this.notes).some((note) => note.message === message && note.status === status && note.log === log);
    if (isDuplicate) return;

    const now = performance.now();
    const timestamp = `${now}_${this.timestampCounter++}`;
    this.notes[timestamp] = { message, status, startTime: now, endTime: now, screenshot, log };
  }

  addUrlNote(state: UrlNoteState, prevState?: { title?: string; h1?: string; h2?: string }): void {
    const fullUrl = state.fullUrl || state.url;
    if (!fullUrl) return;

    let label: string | undefined;
    if (state.title && state.title !== prevState?.title) label = state.title;
    else if (state.h1 && state.h1 !== prevState?.h1) label = state.h1;
    else if (state.h2 && state.h2 !== prevState?.h2) label = state.h2;
    else label = state.title || state.h1 || state.h2;

    if (!label) return;

    this.addNote(`Navigated to ${label}`, TestResult.PASSED, state.screenshotFile, fullUrl);
  }

  addState(state: WebPageState): void {
    this.states.push(state);
  }

  addStep(text: string, duration?: number, status?: string, error?: string, log?: string, artifacts?: string[]): void {
    const timestamp = `${performance.now()}_${this.timestampCounter++}`;
    this.steps[timestamp] = { text, duration, status, error, log, artifacts, noteStartTime: this.activeNote?.getStartTime() };
  }

  setActiveNoteScreenshot(screenshotFile?: string): void {
    if (!this.activeNote || !screenshotFile) return;
    this.activeNote.screenshot = screenshotFile;
  }

  setVerification(message: string, status: TestResultType, state?: UrlNoteState): void {
    this.verification ||= { message: '', status: null, details: [] };
    this.verification.message = message;
    this.verification.status = status;
    if (!state) return;
    if (state.screenshotFile) this.verification.screenshot = state.screenshotFile;
    const fullUrl = state.fullUrl || state.url;
    if (fullUrl) this.verification.url = fullUrl;
    this.verification.pageLabel = state.title || state.h1 || state.h2 || undefined;
  }

  addVerificationDetail(detail: string): void {
    if (!detail) return;
    this.verification ||= { message: '', status: null, details: [] };
    this.verification.details.push(detail);
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

  getRunResult(): 'success' | 'partial' | 'failed' {
    const hasPassedNotes = Object.values(this.notes).some((n) => n.status === TestResult.PASSED);
    return hasPassedNotes ? 'partial' : 'failed';
  }
}

export class Test extends Task {
  scenario: string;
  sessionName?: string;
  status: TestStatusType;
  result: TestResultType;
  priority: 'critical' | 'important' | 'high' | 'normal' | 'low';
  expected: string[];
  plannedSteps: string[];
  plan?: Plan;
  summary: string;
  artifacts: Record<string, string>;
  generatedCode?: string;
  style?: string;
  planIteration = 0;
  enabled = true;
  startTime?: number;
  endTime?: number;
  resetCount = 0;

  constructor(scenario: string, priority: 'critical' | 'important' | 'high' | 'normal' | 'low', expectedOutcome: string | string[], startUrl: string, plannedSteps: string[] = []) {
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

  get isSkipped(): boolean {
    return this.hasFinished && this.result === TestResult.SKIPPED;
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

  getRunResult(): 'success' | 'partial' | 'failed' {
    if (this.isSuccessful) return 'success';
    if (this.hasAchievedAny()) return 'partial';
    return super.getRunResult();
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
    this.startTime = performance.now();
    this.addNote(`Test started. Session name: ${this.sessionName}`);
    this.plan?.notifyChange();
  }

  finish(result: TestResultType = TestResult.FAILED): void {
    this.status = TestStatus.DONE;
    this.result = result;
    this.endTime = performance.now();
    this.plan?.notifyChange();
  }

  getDurationMs(): number | null {
    if (this.startTime != null && this.endTime != null) return this.endTime - this.startTime;
    return null;
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
  parentPlan?: Plan;
  private changeListeners: PlanChangeListener[] = [];

  constructor(title: string) {
    this.title = title;
    if (title.startsWith('/')) this.url = title;
  }

  nextIteration(): void {
    this.iteration++;
  }

  addTest(test: Test): void {
    if (this.tests.some((t) => t.scenario.toLowerCase() === test.scenario.toLowerCase())) return;
    test.plan = this;
    test.planIteration = this.iteration;
    this.tests.push(test);
    this.notifyChange();
  }

  removeTest(test: Test): void {
    const idx = this.tests.indexOf(test);
    if (idx === -1) return;
    this.tests.splice(idx, 1);
    test.plan = undefined;
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

  getAllTests(): Test[] {
    if (!this.parentPlan) return this.tests;
    return [...this.parentPlan.tests, ...this.tests];
  }

  listTests(): Test[] {
    return [...this.tests];
  }

  getPendingTests(): Test[] {
    return this.tests.filter((test) => test.status === 'pending' && test.enabled);
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

  static saveMultipleToMarkdown(plans: Plan[], filePath: string): void {
    savePlansToMarkdown(plans, filePath);
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

  toAiContext(options?: { skipSteps?: boolean }): string {
    return planToAiContext(this, options);
  }
}

interface Verification {
  message: string;
  status: TestResultType;
  screenshot?: string;
  url?: string;
  pageLabel?: string;
  details: string[];
}

interface UrlNoteState {
  url?: string;
  fullUrl?: string;
  title?: string;
  h1?: string;
  h2?: string;
  screenshotFile?: string;
}
