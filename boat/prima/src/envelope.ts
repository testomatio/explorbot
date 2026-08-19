import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const EXPECTATION_LABELS = {
  passed: 'PASSED       ',
  failed: 'FAILED       ',
  unverified: 'not verified ',
  contradiction: 'CONTRADICTION',
};

export interface InstanceInfo {
  name: string;
  tabs: number;
  startedAgo?: string;
  attached?: string;
  others: Array<{ name: string; tabs: number }>;
}

export interface EnvelopeData {
  ok: boolean;
  command: string;
  used?: string[];
  page: { url: string; previousUrl?: string; title: string; state: string; visits: number };
  changes?: string | null;
  steps?: Array<{ label: string; ok: boolean; unconfirmed?: boolean; proof: string }>;
  expectations?: Array<{ text: string; status: 'passed' | 'failed' | 'unverified' | 'contradiction'; evidence?: string }>;
  warning?: string;
  stepFiles?: string;
  value?: string;
  answer?: string;
  research?: string;
  assertions?: Array<{ code: string; passed: boolean; proof: string[] }>;
  failure?: { error: string; compactAria?: string };
  instance: InstanceInfo;
  status?: string;
  artifacts?: { aria: string; html: string; screenshot?: string; network?: string };
}

export function renderEnvelope(data: EnvelopeData): string {
  const sections = [renderResult(data), renderPage(data), renderValue(data), renderChanges(data), renderSteps(data), renderExpectations(data), renderWarning(data), renderOutcome(data), ...renderFailure(data), renderInstance(data), renderArtifacts(data)];
  return sections.filter((section) => section).join('\n\n');
}

export function writeArtifacts(dir: string, snapshot: { aria: string | null; html: string | null; screenshot?: Buffer; requests: unknown[] }): { aria: string; html: string; screenshot?: string; network?: string } {
  mkdirSync(dir, { recursive: true });
  const paths: { aria: string; html: string; screenshot?: string; network?: string } = {
    aria: path.resolve(dir, 'aria.yml'),
    html: path.resolve(dir, 'page.html'),
  };
  writeFileSync(paths.aria, snapshot.aria ?? '', 'utf-8');
  writeFileSync(paths.html, snapshot.html ?? '', 'utf-8');

  if (snapshot.screenshot) {
    paths.screenshot = path.resolve(dir, 'page.png');
    writeFileSync(paths.screenshot, snapshot.screenshot);
  }

  if (!snapshot.requests.length) return paths;

  paths.network = path.resolve(dir, 'network.jsonl');
  writeFileSync(paths.network, snapshot.requests.map((request) => `${JSON.stringify(request)}\n`).join(''), 'utf-8');
  return paths;
}

function renderResult(data: EnvelopeData): string {
  const lines = [`ok: ${data.ok}`, `command: ${data.command}`];
  if (data.used?.length) lines.push(`used: ${data.used.join('; ')}`);
  return section('Result', lines.join('\n'));
}

function renderPage(data: EnvelopeData): string {
  const { url, previousUrl, title, state, visits } = data.page;
  const urlLabel = `url: ${url}`;
  const stateLabel = `state: ${state}`;
  const width = Math.max(urlLabel.length, stateLabel.length) + 3;
  let changedMarker = '';
  if (previousUrl && previousUrl !== url) changedMarker = `(changed: ${previousUrl} → ${url})`;
  const lines = [align(urlLabel, changedMarker, width), `title: ${title}`, align(stateLabel, `(visit #${visits})`, width)];
  return section('Page', lines.join('\n'));
}

function renderValue(data: EnvelopeData): string | null {
  if (data.value === undefined) return null;
  return section('Value', data.value);
}

function renderChanges(data: EnvelopeData): string | null {
  if (data.changes === undefined || data.changes === null) return null;
  return section('Changes', data.changes);
}

function renderSteps(data: EnvelopeData): string | null {
  if (!data.steps?.length) return null;

  const lines: string[] = [];
  data.steps.forEach((step, index) => {
    let mark = 'FAIL';
    if (step.ok) mark = 'ok  ';
    if (step.unconfirmed) mark = '??  ';
    lines.push(`${index + 1}. ${mark} ${step.label}`);
    for (const line of (step.proof || '').split('\n').filter(Boolean)) lines.push(`      ${line}`);
  });
  if (data.stepFiles) lines.push('', `page after each step: ${data.stepFiles}`);
  return section('Steps', lines.join('\n'));
}

function renderExpectations(data: EnvelopeData): string | null {
  if (!data.expectations?.length) return null;

  const lines: string[] = [];
  data.expectations.forEach((expectation, index) => {
    lines.push(`${index + 1}. ${EXPECTATION_LABELS[expectation.status]} ${expectation.text}`);
    if (expectation.status !== 'contradiction' && expectation.status !== 'failed') return;
    for (const line of (expectation.evidence || '').split('\n').filter(Boolean)) lines.push(`      ${line}`);
  });
  return section('Expected outcomes', lines.join('\n'));
}

function renderWarning(data: EnvelopeData): string | null {
  if (!data.warning) return null;
  return section('Warning', data.warning);
}

function renderOutcome(data: EnvelopeData): string | null {
  if (data.answer) return section('Answer', data.answer);
  if (data.research) return section('Research', data.research);
  if (!data.assertions) return null;

  if (!data.assertions.length) return section('Assertions', 'none ran — no assertion could express this claim, so nothing was checked against the page');

  const lines = data.assertions.map((assertion) => {
    const code = assertion.code
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('//'))
      .join(' ');
    return `${code}  => ${assertion.passed ? 'PASSED' : 'FAILED'}`;
  });

  const proof = data.assertions.flatMap((assertion) => assertion.proof);
  if (proof.length) lines.push('', 'playwright:', ...proof);

  return section('Assertions', lines.join('\n'));
}

function renderFailure(data: EnvelopeData): Array<string | null> {
  if (!data.failure) return [];
  return [section('Failure', `error: ${data.failure.error}`), renderCompactAria(data.failure.compactAria)];
}

function renderCompactAria(compactAria?: string): string | null {
  if (!compactAria) return null;
  return section('Current page (compact ARIA)', compactAria);
}

function renderInstance(data: EnvelopeData): string | null {
  const instance = data.instance;
  const parts = [`${instance.name} (${tabsLabel(instance.tabs)})`, browserLine(instance)];
  if (instance.others.length) parts.push(`other instances: ${instance.others.map((other) => `${other.name} (${tabsLabel(other.tabs)})`).join(', ')}`);
  if (data.status) parts.push(`details: prima status ${data.status}`);
  return section('Instance', parts.join(' | '));
}

function browserLine(instance: InstanceInfo): string {
  if (instance.attached) return `attached to ${instance.attached}`;
  if (instance.startedAgo) return `running, started ${instance.startedAgo} ago`;
  if (instance.tabs > 0) return 'running';
  return 'not running';
}

function tabsLabel(tabs: number): string {
  if (tabs === 1) return '1 tab';
  return `${tabs} tabs`;
}

export function renderArtifacts(data: EnvelopeData): string | null {
  if (!data.artifacts) return null;
  const lines = [`aria:       ${data.artifacts.aria}`, `html:       ${data.artifacts.html}`];
  if (data.artifacts.screenshot) lines.push(`screenshot: ${data.artifacts.screenshot}`);
  if (data.artifacts.network) lines.push(`network:    ${data.artifacts.network}`);
  return section('Artifacts', lines.join('\n'));
}

function align(label: string, marker: string, width: number): string {
  if (!marker) return label;
  return `${label.padEnd(width)}${marker}`;
}

function section(title: string, body: string): string {
  return `### ${title}\n${body}`;
}
