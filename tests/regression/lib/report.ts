export const REPORT_MARKER = '<!-- explorbot-regression-report -->';
const NOTABLE_CHANGE_PCT = 20;

export function buildReport(records: RunRecord[], history: RunRecord[][] = []): string {
  const rows: string[] = [];
  const detailLines: string[] = [];

  for (const rec of records) {
    const baseline = medianTime(rec.label, history);
    rows.push(`| ${rec.label} | ${resultCell(rec)} | ${fmtDuration(rec.durationSec)} | ${baselineCell(baseline)} | ${changeCell(rec.durationSec, baseline)} |`);
    detailLines.push(`- ${rec.label} — ${passLabel(rec)} (${fmtDuration(rec.durationSec)}): ${rec.details.join('; ')}`);
  }

  const table = ['| Scenario | Result | Time | Previous median | Change |', '|---|---|---|---|---|', ...rows].join('\n');
  const parts = [REPORT_MARKER, '# Explorbot Self-Regression', '', commitLine(), '', table, '', speedNote(history), '', '## Run details', ...detailLines, ''];

  for (const rec of records) {
    if (!rec.analysis) continue;
    parts.push('---', '', `_Session analysis — ${rec.label}:_`, '', rec.analysis, '');
  }

  return parts.join('\n');
}

export function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

function medianTime(label: string, history: RunRecord[][]): number | null {
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

function speedNote(history: RunRecord[][]): string {
  if (history.length === 0) return '_No previous runs with timings yet; this run becomes the baseline._';
  return `_Change compares it with the median passing time of the last ${history.length} runs; ±${NOTABLE_CHANGE_PCT}% or more is flagged._`;
}

function resultCell(rec: RunRecord): string {
  if (rec.kind === 'control') {
    if (rec.passed) return 'OK — failed as expected';
    return 'FAIL — passed without seeds';
  }
  if (rec.kind === 'info') {
    if (rec.passed) return 'ran';
    return 'crashed';
  }
  if (rec.passed) return 'PASS';
  return 'FAIL';
}

function passLabel(rec: RunRecord): string {
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

export interface RunRecord {
  scenario: string;
  label: string;
  kind: 'gate' | 'control' | 'info';
  passed: boolean;
  durationSec: number;
  details: string[];
  analysis?: string | null;
}
