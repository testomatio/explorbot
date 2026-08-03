import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface InstanceInfo {
  name: string;
  tabs: number;
  startedAgo?: string;
  attached?: string;
  others: Array<{ name: string; tabs: number }>;
}

export interface HealAttempt {
  code: string;
  outcome: string;
}

export interface EnvelopeData {
  ok: boolean;
  command: string;
  healed?: boolean;
  healNote?: string;
  used?: string[];
  page: { url: string; previousUrl?: string; title: string; state: string; visits: number };
  changes?: string | null;
  answer?: string;
  research?: string;
  verdict?: { passed: boolean; evidence: string; code: string };
  failure?: { error: string; attempts: HealAttempt[]; reasoning?: string; compactAria?: string };
  instance: InstanceInfo;
  artifacts?: { aria: string; html: string; network: string };
}

export function renderEnvelope(data: EnvelopeData): string {
  const sections = [renderResult(data), renderPage(data), renderOutcome(data), ...renderFailure(data), renderInstance(data.instance), renderArtifacts(data)];
  return sections.filter((section) => section).join('\n\n');
}

export function writeArtifacts(dir: string, snapshot: { aria: string | null; html: string | null; requests: unknown[] }): { aria: string; html: string; network: string } {
  mkdirSync(dir, { recursive: true });
  const paths = {
    aria: path.resolve(dir, 'aria.yml'),
    html: path.resolve(dir, 'page.html'),
    network: path.resolve(dir, 'network.jsonl'),
  };
  writeFileSync(paths.aria, snapshot.aria ?? '', 'utf-8');
  writeFileSync(paths.html, snapshot.html ?? '', 'utf-8');
  writeFileSync(paths.network, snapshot.requests.map((request) => `${JSON.stringify(request)}\n`).join(''), 'utf-8');
  return paths;
}

function renderResult(data: EnvelopeData): string {
  const lines = [`ok: ${data.ok}`, `command: ${data.command}`];
  const healed = renderHealed(data);
  if (healed) lines.push(healed);
  if (data.used?.length) lines.push(`used: ${data.used.join('; ')}`);
  return section('Result', lines.join('\n'));
}

function renderHealed(data: EnvelopeData): string | null {
  if (data.healed === undefined) return null;
  if (data.healNote) return `healed: ${data.healed} (${data.healNote})`;
  return `healed: ${data.healed}`;
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

function renderOutcome(data: EnvelopeData): string | null {
  if (data.changes) return section('Changes', data.changes);
  if (data.answer) return section('Answer', data.answer);
  if (data.research) return section('Research', data.research);
  if (!data.verdict) return null;
  const lines = [`passed: ${data.verdict.passed}`, `evidence: ${data.verdict.evidence}`, `code: ${data.verdict.code}`];
  return section('Verdict', lines.join('\n'));
}

function renderFailure(data: EnvelopeData): Array<string | null> {
  if (!data.failure) return [];
  const lines = [`error: ${data.failure.error}`];
  if (data.failure.reasoning) lines.push(`reasoning: ${data.failure.reasoning}`);
  return [section('Failure', lines.join('\n')), renderAttempts(data.failure.attempts), renderCompactAria(data.failure.compactAria)];
}

function renderAttempts(attempts: HealAttempt[]): string | null {
  if (!attempts?.length) return null;
  const labels = attempts.map((attempt, index) => `${index + 1}. ${attempt.code}`);
  const width = Math.max(...labels.map((label) => label.length)) + 3;
  const lines = labels.map((label, index) => align(label, `→ ${attempts[index].outcome}`, width));
  return section(`Healing attempts (${attempts.length})`, lines.join('\n'));
}

function renderCompactAria(compactAria?: string): string | null {
  if (!compactAria) return null;
  return section('Current page (compact ARIA)', compactAria);
}

function renderInstance(instance: InstanceInfo): string {
  const others = instance.others.map((other) => `${other.name} (${tabsLabel(other.tabs)})`);
  const lines = [`instance: ${instance.name} (${tabsLabel(instance.tabs)}) | other instances: ${otherInstances(others)}`, browserLine(instance)];
  return section('Instance', lines.join('\n'));
}

function otherInstances(others: string[]): string {
  if (!others.length) return 'none';
  return others.join(', ');
}

function browserLine(instance: InstanceInfo): string {
  if (instance.attached) return `browser: attached (${instance.attached})`;
  if (instance.startedAgo) return `browser: running, started ${instance.startedAgo} ago`;
  return 'browser: running';
}

function tabsLabel(tabs: number): string {
  if (tabs === 1) return '1 tab';
  return `${tabs} tabs`;
}

function renderArtifacts(data: EnvelopeData): string | null {
  if (!data.artifacts) return null;
  const lines = [`aria: ${data.artifacts.aria}`, `html: ${data.artifacts.html}`, `network: ${data.artifacts.network}`];
  return section('Artifacts', lines.join('\n'));
}

function align(label: string, marker: string, width: number): string {
  if (!marker) return label;
  return `${label.padEnd(width)}${marker}`;
}

function section(title: string, body: string): string {
  return `### ${title}\n${body}`;
}
