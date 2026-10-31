export const REPORT_MARKER = '<!-- explorbot-regression-report -->';
const NOTABLE_CHANGE_PCT = 20;

export function buildReport(records: AttemptRecord[], history: AttemptRecord[][] = []): string {
  const groups = groupByLabel(records);
  const rows: string[] = [];
  const detailLines: string[] = [];

  for (const group of groups) {
    const baseline = medianTime(group.label, history);
    rows.push(`| ${group.label} | ${resultCell(group)} | ${group.attemptsUsed}/${group.maxAttempts} | ${fmtDuration(group.timeSec)} | ${baselineCell(baseline)} | ${changeCell(group.timeSec, baseline)} |`);
    for (const rec of group.records) {
      detailLines.push(`- ${group.label} attempt ${rec.attempt} — ${passLabel(rec)} (${fmtDuration(rec.durationSec)}): ${rec.details.join('; ')}`);
    }
  }

  const table = ['| Scenario | Result | Attempts | Time | Previous median | Change |', '|---|---|---|---|---|---|', ...rows].join('\n');
  const parts = [REPORT_MARKER, '# Explorbot Self-Regression', '', commitLine(), '', table, '', speedNote(history), '', '## Attempt details', ...detailLines, ''];

  for (const group of groups) {
    const analysis = analysisFor(group);
    if (!analysis) continue;
    parts.push('---', '', `_Session analysis — ${group.label}:_`, '', analysis, '');
  }

  return parts.join('\n');
}

export function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

function analysisFor(group: Group): string | null {
  const passing = group.records.find((r) => r.passed && r.analysis);
  if (passing?.analysis) return passing.analysis;
  const latest = [...group.records].reverse().find((r) => r.analysis);
  if (latest?.analysis) return latest.analysis;
  return null;
}

function groupByLabel(records: AttemptRecord[]): Group[] {
  const order: string[] = [];
  const byLabel = new Map<string, AttemptRecord[]>();
  for (const rec of records) {
    if (!byLabel.has(rec.label)) {
      byLabel.set(rec.label, []);
      order.push(rec.label);
    }
    byLabel.get(rec.label)!.push(rec);
  }

  return order.map((label) => {
    const recs = byLabel.get(label)!;
    const passed = recs.some((r) => r.passed);
    const timed = recs.find((r) => r.passed) || recs[recs.length - 1];
    return { label, records: recs, passed, kind: recs[0].kind, attemptsUsed: recs.length, maxAttempts: recs[0].maxAttempts, timeSec: timed.durationSec };
  });
}

function medianTime(label: string, history: AttemptRecord[][]): number | null {
  const times = history
    .map((run) => run.find((r) => r.label === label && r.passed)?.durationSec)
    .filter((sec): sec is number => typeof sec === 'number')
    .sort((a, b) => a - b);
  if (times.length === 0) return null;
  const mid = Math.floor(times.length / 2);
  if (times.length % 2) return times[mid];
  return Math.round((times[mid - 1] + times[mid]) / 2);
}

function baselineCell(baseline: number | null): string {
  if (!baseline) return '—';
  return fmtDuration(baseline);
}

function changeCell(sec: number, baseline: number | null): string {
  if (!baseline) return '—';
  const pct = Math.round(((sec - baseline) / baseline) * 100);
  if (pct >= NOTABLE_CHANGE_PCT) return `+${pct}% slower`;
  if (pct <= -NOTABLE_CHANGE_PCT) return `${pct}% faster`;
  if (pct > 0) return `+${pct}%`;
  return `${pct}%`;
}

function speedNote(history: AttemptRecord[][]): string {
  if (history.length === 0) return '_No previous runs with timings yet; this run becomes the baseline._';
  return `_Time is the passing attempt (the last attempt if none passed). Change compares it with the median passing time of the last ${history.length} runs; ±${NOTABLE_CHANGE_PCT}% or more is flagged._`;
}

function resultCell(group: Group): string {
  if (group.kind === 'control') {
    if (group.passed) return 'OK — failed as expected';
    return 'FAIL — passed without seeds';
  }
  if (group.kind === 'info') {
    if (group.passed) return 'ran';
    return 'crashed';
  }
  if (group.passed) return 'PASS';
  return 'FAIL';
}

function passLabel(rec: AttemptRecord): string {
  if (rec.passed) return 'PASS';
  return 'FAIL';
}

function commitLine(): string {
  const sha = process.env.GITHUB_SHA || 'local';
  const sha7 = sha.slice(0, 7);
  const server = process.env.GITHUB_SERVER_URL;
  const repo = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  if (!server || !repo || !runId) return `Commit \`${sha7}\``;
  return `Commit \`${sha7}\` · [run](${server}/${repo}/actions/runs/${runId})`;
}

export interface AttemptRecord {
  scenario: string;
  label: string;
  kind: 'gate' | 'control' | 'info';
  attempt: number;
  maxAttempts: number;
  passed: boolean;
  durationSec: number;
  details: string[];
  analysis?: string | null;
}

interface Group {
  label: string;
  records: AttemptRecord[];
  passed: boolean;
  kind: 'gate' | 'control' | 'info';
  attemptsUsed: number;
  maxAttempts: number;
  timeSec: number;
}
