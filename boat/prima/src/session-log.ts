import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { outputPath } from '../../../src/config.ts';
import { safeFilename } from '../../../src/utils/strings.ts';
import { type EnvelopeData, renderEnvelope } from './envelope.ts';

const EXPECTATION_STATUS = { passed: 'passed', failed: 'failed', unverified: 'skipped' };

export function sessionsDir(): string {
  return outputPath('prima', 'sessions');
}

export function sessionFile(key: string): string {
  return path.join(sessionsDir(), `${safeFilename(key)}.jsonl`);
}

export function latestSessionFile(): string | null {
  const dir = sessionsDir();
  if (!existsSync(dir)) return null;

  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => path.join(dir, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);

  return files[0] || null;
}

export function recordCommand(file: string, session: SessionRun, envelope: EnvelopeData, durationMs: number): void {
  mkdirSync(path.dirname(file), { recursive: true });
  if (recordedEndpoint(file) !== session.endpoint) writeFileSync(file, jsonLine({ action: 'createRun', endpoint: session.endpoint, params: { title: session.title } }), 'utf-8');
  appendFileSync(file, jsonLine({ action: 'addTest', testId: commandTest(envelope, durationMs) }), 'utf-8');
}

export function readSession(file: string): { title: string; tests: any[] } {
  const entries = readEntries(file);
  const run = entries.find((entry) => entry.action === 'createRun');
  const tests = entries.filter((entry) => entry.action === 'addTest').map((entry) => entry.testId);
  return { title: run?.params?.title || 'prima session', tests };
}

function commandTest(envelope: EnvelopeData, durationMs: number): any {
  let status = 'failed';
  if (envelope.ok) status = 'passed';

  const test: any = {
    rid: envelope.status,
    title: envelope.command,
    suite_title: 'Prima session',
    status,
    file: '<prima>',
    description: [`page: ${envelope.page.url}`, envelope.stepFiles && `artifacts: ${envelope.stepFiles}`].filter(Boolean).join('\n'),
    code: (envelope.used || []).join('\n'),
    steps: commandSteps(envelope),
    logs: renderEnvelope(envelope),
    time: Math.round(durationMs),
  };

  if (envelope.failure) test.error = { message: envelope.failure.error };
  return test;
}

function commandSteps(envelope: EnvelopeData): any[] {
  const steps: any[] = [];

  for (const step of envelope.steps || []) {
    const entry: any = { category: 'user', title: step.label, status: 'passed', duration: 0, log: step.proof };
    if (!step.ok) {
      entry.status = 'failed';
      entry.error = step.proof;
    }
    steps.push(entry);
  }

  for (const expectation of envelope.expectations || []) {
    const entry: any = { category: 'user', title: `expected: ${expectation.text}`, status: EXPECTATION_STATUS[expectation.status], duration: 0 };
    if (expectation.status === 'failed') entry.error = 'the run did not reach this outcome';
    steps.push(entry);
  }

  for (const assertion of envelope.assertions || []) {
    const entry: any = { category: 'user', title: assertion.code, status: 'passed', duration: 0, log: assertion.proof.join('\n') };
    if (!assertion.passed) {
      entry.status = 'failed';
      entry.error = 'the assertion did not hold on the page';
    }
    steps.push(entry);
  }

  return steps;
}

function recordedEndpoint(file: string): string | null {
  const [first] = readEntries(file);
  return first?.endpoint || null;
}

function readEntries(file: string): any[] {
  if (!existsSync(file)) return [];

  const entries: any[] = [];
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    const entry = parseLine(line);
    if (entry) entries.push(entry);
  }
  return entries;
}

function parseLine(line: string): any {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function jsonLine(entry: unknown): string {
  return `${JSON.stringify(entry)}\n`;
}

export interface SessionRun {
  key: string;
  endpoint: string;
  title: string;
}
