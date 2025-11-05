import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import figures from 'figures';
import { WebPageState } from './state-manager.ts';

export interface Note {
  message: string;
  status: 'passed' | 'failed' | null;
  expected?: boolean;
  step?: boolean;
}

export class Test {
  id: string;
  scenario: string;
  status: 'pending' | 'in_progress' | 'done';
  priority: 'high' | 'medium' | 'low' | 'unknown';
  expected: string[];
  plannedSteps: string[];
  notes: Note[];
  steps: string[];
  description?: string;
  states: WebPageState[];
  startUrl: string;
  plan?: Plan;
  summary: string;
  artifacts: string[];

  constructor(scenario: string, priority: 'high' | 'medium' | 'low' | 'unknown', expectedOutcome: string | string[], startUrl: string, plannedSteps: string[] = []) {
    this.id = `${createHash('md5').update(scenario).digest('hex').slice(0, 8)}_${Date.now().toString(36)}`;
    this.scenario = scenario;
    this.status = 'pending';
    this.priority = priority;
    this.expected = Array.isArray(expectedOutcome) ? expectedOutcome : [expectedOutcome];
    this.plannedSteps = plannedSteps;
    this.notes = [];
    this.steps = [];
    this.states = [];
    this.startUrl = startUrl;
    this.artifacts = [];
    this.summary = '';
  }

  getPrintableNotes(): string[] {
    return this.notes.map((n) => {
      const icon = n.status === 'passed' ? figures.tick : n.status === 'failed' ? figures.cross : figures.circle;
      const prefix = n.expected ? 'EXPECTED: ' : '';
      return `${icon} ${n.message} ${prefix}`;
    });
  }

  getVisitedUrls({ localOnly = false }: { localOnly?: boolean } = {}): string[] {
    if (this.plan && !localOnly) {
      return this.plan.tests.flatMap((t) => t.getVisitedUrls({ localOnly: true }));
    }
    return [...new Set([this.startUrl, ...this.states.map((s) => s.url)].filter((value): value is string => Boolean(value) && value.trim() !== ''))];
  }

  notesToString(): string {
    return this.getPrintableNotes().join('\n');
  }

  addArtifact(artifact: string): void {
    this.artifacts.push(artifact);
  }

  addNote(message: string, status: 'passed' | 'failed' | null = null, expected = false): void {
    if (!expected && this.expected.includes(message)) {
      expected = true;
    }

    const isDuplicate = this.notes.some((note) => note.message === message && note.status === status && note.expected === expected);
    if (isDuplicate) return;

    this.notes.push({ message, status, expected });
  }

  addState(state: WebPageState): void {
    this.states.push(state);
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

  start(): void {
    this.status = 'in_progress';
    this.addNote('Test started');
  }

  finish(): void {
    this.status = 'done';
  }

  getRemainingExpectations(): string[] {
    const achieved = this.getCheckedExpectations();
    return this.expected.filter((e) => !achieved.includes(e));
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

  updateStatus(): void {
    this.tests.forEach((test) => test.updateStatus());
  }

  static fromMarkdown(filePath: string): Plan {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    let title = '';
    let currentTest: Test | null = null;
    let inRequirements = false;
    let inSteps = false;
    let inExpected = false;
    let priority: 'high' | 'medium' | 'low' | 'unknown' = 'unknown';

    const plan = new Plan('');

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
        inSteps = false;
        inExpected = false;
        continue;
      }

      if (currentTest && line === '## Requirements') {
        inRequirements = true;
        inSteps = false;
        inExpected = false;
        continue;
      }

      if (currentTest && line === '## Steps') {
        inRequirements = false;
        inSteps = true;
        inExpected = false;
        continue;
      }

      if (currentTest && line === '## Expected') {
        inRequirements = false;
        inSteps = false;
        inExpected = true;
        continue;
      }

      if (currentTest && inRequirements && line && !line.startsWith('##')) {
        currentTest.startUrl = line;
        continue;
      }

      if (currentTest && inSteps && line.startsWith('* ')) {
        let step = line.replace(/^\*\s+/, '');

        // Check for multiline content (indented lines following the * line)
        let j = i + 1;
        while (j < lines.length) {
          const nextLine = lines[j];
          const trimmedNext = nextLine.trim();

          // Stop if we hit a new list item (line starting with * at the beginning)
          if (nextLine.match(/^\*\s+/)) {
            break;
          }

          // Stop if we hit a section marker or end marker
          if (trimmedNext.startsWith('##') || trimmedNext.startsWith('<!--')) {
            break;
          }

          // If line starts with spaces (indented), it's part of this step
          if (nextLine.startsWith('  ')) {
            step += '\n' + nextLine;
            j++;
          } else if (trimmedNext === '') {
            // Stop on empty lines (they separate steps)
            break;
          } else {
            break;
          }
        }

        currentTest.plannedSteps.push(step);
        i = j - 1; // Update loop counter to skip processed lines
        continue;
      }

      if (currentTest && inExpected && line.startsWith('* ')) {
        let expectation = line.replace(/^\*\s+/, '');

        // Check for multiline content (indented lines following the * line)
        let j = i + 1;
        while (j < lines.length) {
          const nextLine = lines[j];
          const trimmedNext = nextLine.trim();

          // Stop if we hit a new list item (line starting with * at the beginning)
          if (nextLine.match(/^\*\s+/)) {
            break;
          }

          // Stop if we hit a section marker or end marker
          if (trimmedNext.startsWith('##') || trimmedNext.startsWith('<!--')) {
            break;
          }

          // If line starts with spaces (indented), it's part of this expectation
          if (nextLine.startsWith('  ')) {
            expectation += '\n' + nextLine;
            j++;
          } else if (trimmedNext === '') {
            // Stop on empty lines (they separate expectations)
            break;
          } else {
            break;
          }
        }

        currentTest.expected.push(expectation);
        i = j - 1; // Update loop counter to skip processed lines
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

      if (test.plannedSteps.length > 0) {
        content += '## Steps\n';
        for (const step of test.plannedSteps) {
          const lines = step.split('\n');
          content += `* ${lines[0]}\n`;

          // Add indented continuation lines
          for (let i = 1; i < lines.length; i++) {
            content += `${lines[i]}\n`;
          }
        }
        content += '\n';
      }

      content += '## Expected\n';

      for (const expectation of test.expected) {
        const lines = expectation.split('\n');
        content += `* ${lines[0]}\n`;

        // Add indented continuation lines
        for (let i = 1; i < lines.length; i++) {
          content += `${lines[i]}\n`;
        }
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

      if (test.plannedSteps.length > 0) {
        content += '**Planned Steps:**\n';
        for (const step of test.plannedSteps) {
          content += `- ${step}\n`;
        }
        content += '\n';
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
