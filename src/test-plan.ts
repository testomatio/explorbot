import { readFileSync, writeFileSync } from 'node:fs';
import figures from 'figures';
import { WebPageState } from './state-manager.ts';

export interface Note {
  message: string;
  status: 'passed' | 'failed' | null;
  expected?: boolean;
}

export class Test {
  scenario: string;
  status: 'pending' | 'in_progress' | 'done';
  priority: 'high' | 'medium' | 'low' | 'unknown';
  expected: string[];
  notes: Note[];
  steps: string[];
  states: WebPageState[];
  startUrl?: string;

  constructor(scenario: string, priority: 'high' | 'medium' | 'low' | 'unknown', expectedOutcome: string | string[]) {
    this.scenario = scenario;
    this.status = 'pending';
    this.priority = priority;
    this.expected = Array.isArray(expectedOutcome) ? expectedOutcome : [expectedOutcome];
    this.notes = [];
    this.steps = [];
    this.states = [];
  }

  getPrintableNotes(): string[] {
    const noteIcons = ['◴', '◵', '◶', '◷'];
    let noteIndex = 0;

    return this.notes.map((n) => {
      const icon = n.status === 'passed' ? figures.tick : n.status === 'failed' ? figures.cross : noteIcons[noteIndex++ % noteIcons.length];
      const prefix = n.expected ? 'EXPECTED: ' : '';
      return `${icon} ${prefix}${n.message}`;
    });
  }

  notesToString(): string {
    return this.getPrintableNotes().join('\n');
  }

  addNote(message: string, status: 'passed' | 'failed' | null = null, expected = false): void {
    if (!expected && this.expected.includes(message)) {
      expected = true;
    }

    const isDuplicate = this.notes.some((note) => note.message === message && note.status === status && note.expected === expected);
    if (isDuplicate) return;

    this.notes.push({ message, status, expected });
  }

  addStep(text: string): void {
    this.steps.push(text);
  }

  get hasFinished(): boolean {
    return this.status === 'done' || this.isComplete();
  }

  get isSuccessful(): boolean {
    return this.hasFinished && this.hasAchievedAny();
  }

  get hasFailed(): boolean {
    return this.hasFinished && !this.hasAchievedAny();
  }

  getCheckedNotes(): Note[] {
    return this.notes.filter((n) => !!n.status);
  }

  getCheckedExpectations(): string[] {
    return this.notes.filter((n) => n.expected && !!n.status).map((n) => n.message);
  }

  hasAchievedAny(): boolean {
    return this.notes.some((n) => n.expected && n.status === 'passed');
  }

  hasAchievedAll(): boolean {
    return this.notes.filter((n) => n.expected && n.status === 'passed').length === this.expected.length;
  }

  isComplete(): boolean {
    return this.notes.filter((n) => n.expected && !!n.status).length === this.expected.length;
  }

  updateStatus(): void {
    if (this.hasAchievedAny() && this.isComplete()) {
      this.status = 'success';
      return;
    }

    if (this.isComplete() && this.notes.length && !this.notes.some((n) => n.status === 'passed')) {
      this.status = 'failed';
      return;
    }

    if (this.isComplete()) {
      this.status = 'done';
    }
  }

  start(): void {
    this.status = 'in_progress';
    this.addNote('Test started');
  }

  finish(): void {
    this.status = 'done';
    this.updateStatus();
  }

  getRemainingExpectations(): string[] {
    const achieved = this.getCheckedExpectations();
    return this.expected.filter((e) => !achieved.includes(e));
  }
}

export class Plan {
  title: string;
  tests: Test[];
  url?: string;

  constructor(title: string, tests: Test[]) {
    this.title = title;
    if (title.startsWith('/')) this.url = title;
    this.tests = tests;
  }

  addTest(test: Test): void {
    this.tests.push(test);
  }

  initialState(state: WebPageState): void {
    this.url = state.url;
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

  updateStatus(): void {
    this.tests.forEach((test) => test.updateStatus());
  }

  static fromMarkdown(filePath: string): Plan {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    let title = '';
    let currentTest: Test | null = null;
    let inRequirements = false;
    let inExpected = false;
    let priority: 'high' | 'medium' | 'low' | 'unknown' = 'unknown';

    const plan = new Plan('', []);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line.startsWith('<!-- suite -->') && !plan.title) {
        title = lines[i + 1]?.replace(/^#\s+/, '') || '';
        plan.title = title;
        i++; // Skip the title line to avoid processing it as a test
        continue;
      }

      if (line.startsWith('<!-- test')) {
        const priorityMatch = line.match(/priority:\s*(\w+)/);
        priority = (priorityMatch?.[1] as 'high' | 'medium' | 'low' | 'unknown') || 'unknown';
        continue;
      }

      if (line.startsWith('# ') && currentTest === null) {
        const scenario = line.replace(/^#\s+/, '');
        currentTest = new Test(scenario, priority, []);
        plan.addTest(currentTest);
        inRequirements = false;
        inExpected = false;
        continue;
      }

      if (currentTest && line === '## Requirements') {
        inRequirements = true;
        inExpected = false;
        continue;
      }

      if (currentTest && line === '## Expected') {
        inRequirements = false;
        inExpected = true;
        continue;
      }

      if (currentTest && inRequirements && line && !line.startsWith('##')) {
        currentTest.startUrl = line;
        continue;
      }

      if (currentTest && inExpected && line.startsWith('* ')) {
        const expectation = line.replace(/^\*\s+/, '');
        currentTest.expected.push(expectation);
        continue;
      }

      if (line.startsWith('<!-- test -->') || line.startsWith('<!-- suite -->')) {
        currentTest = null;
        inRequirements = false;
        inExpected = false;
        priority = 'unknown';
      }
    }

    return plan;
  }

  saveToMarkdown(filePath: string): void {
    let content = `<!-- suite -->\n# ${this.title}\n\n`;

    for (const test of this.tests) {
      content += `<!-- test\npriority: ${test.priority}\n-->\n`;
      content += `# ${test.scenario}\n\n`;
      content += '## Requirements\n';
      content += `${test.startUrl || 'Current page'}\n\n`;
      content += '## Expected\n';

      for (const expectation of test.expected) {
        content += `* ${expectation}\n`;
      }

      content += '\n';
    }

    writeFileSync(filePath, content, 'utf-8');
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

    const mergedPlan = new Plan(mergedTitle, mergedTests);
    if (mergedUrl) {
      mergedPlan.url = mergedUrl;
    }

    return mergedPlan;
  }

  toAiContext(): string {
    let content = `# Test Plan: ${this.title}\n\n`;

    if (this.url) {
      content += `**URL:** ${this.url}\n\n`;
    }

    content += `**Total Tests:** ${this.tests.length}\n`;
    content += `**Status:** ${this.isComplete ? 'Complete' : 'In Progress'}\n\n`;

    for (let i = 0; i < this.tests.length; i++) {
      const test = this.tests[i];
      content += `## Test ${i + 1}: ${test.scenario}\n\n`;
      content += `**Priority:** ${test.priority}\n`;
      content += `**Status:** ${test.status}\n\n`;

      if (test.startUrl) {
        content += `**Start URL:** ${test.startUrl}\n\n`;
      }

      if (test.expected.length > 0) {
        content += '**Expected Outcomes:**\n';
        for (const expectation of test.expected) {
          content += `- ${expectation}\n`;
        }
        content += '\n';
      }

      if (test.steps.length > 0) {
        content += '**Steps:**\n';
        for (const step of test.steps) {
          content += `- ${step}\n`;
        }
        content += '\n';
      }

      if (test.notes.length > 0) {
        content += '**Notes:**\n';
        for (const note of test.getPrintableNotes()) {
          content += `${note}\n`;
        }
        content += '\n';
      }

      content += '---\n\n';
    }

    return content;
  }
}
