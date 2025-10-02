import figures from 'figures';
import { readFileSync, writeFileSync } from 'fs';
import { WebPageState } from './state-manager.ts';

export interface Note {
  message: string;
  status: 'passed' | 'failed' | null;
  expected?: boolean;
}

export class Test {
  scenario: string;
  status: 'pending' | 'in_progress' | 'success' | 'failed' | 'done';
  priority: 'high' | 'medium' | 'low' | 'unknown';
  expected: string[];
  notes: Note[];
  steps: string[];
  startUrl?: string;

  constructor(scenario: string, priority: 'high' | 'medium' | 'low' | 'unknown', expectedOutcome: string | string[]) {
    this.scenario = scenario;
    this.status = 'pending';
    this.priority = priority;
    this.expected = Array.isArray(expectedOutcome) ? expectedOutcome : [expectedOutcome];
    this.notes = [];
    this.steps = [];
  }

  getPrintableNotes(): string {
    const icons = {
      passed: figures.tick,
      failed: figures.cross,
      no: figures.square,
    };
    return this.notes.map((n) => `${icons[n.status || 'no']} ${n.message}`).join('\n');
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
    return this.status === 'success';
  }

  get hasFailed(): boolean {
    return this.status === 'failed';
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

  get completed(): boolean {
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

    const plan = new Plan('');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line.startsWith('<!-- suite -->')) {
        title = lines[i + 1]?.replace(/^#\s+/, '') || '';
        plan.title = title;
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
      content += `## Requirements\n`;
      content += `${test.startUrl || 'Current page'}\n\n`;
      content += `## Expected\n`;

      for (const expectation of test.expected) {
        content += `* ${expectation}\n`;
      }

      content += '\n';
    }

    writeFileSync(filePath, content, 'utf-8');
  }
}
