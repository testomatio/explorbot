export const REPORT_MARKER = '<!-- explorbot-regression-report -->';

export function buildReport(records: AttemptRecord[]): string {
  const groups = groupByLabel(records);
  const rows: string[] = [];
  const detailLines: string[] = [];

  for (const group of groups) {
    rows.push(`| ${group.label} | ${resultCell(group)} | ${group.attemptsUsed}/${group.maxAttempts} | ${fmtDuration(group.durationSec)} |`);
    for (const rec of group.records) {
      detailLines.push(`- ${group.label} attempt ${rec.attempt} — ${passLabel(rec)}: ${rec.details.join('; ')}`);
    }
  }

  const table = ['| Scenario | Result | Attempts | Duration |', '|---|---|---|---|', ...rows].join('\n');
  const parts = [REPORT_MARKER, '# Explorbot Self-Regression', '', commitLine(), '', table, '', '## Attempt details', ...detailLines, ''];

  for (const group of groups) {
    const analysis = analysisFor(group);
    if (!analysis) continue;
    parts.push('---', '', `_Session analysis — ${group.label}:_`, '', analysis, '');
  }

  return parts.join('\n');
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
    const durationSec = recs.reduce((sum, r) => sum + r.durationSec, 0);
    return { label, records: recs, passed, kind: recs[0].kind, attemptsUsed: recs.length, maxAttempts: recs[0].maxAttempts, durationSec };
  });
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

function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  return `${Math.round(sec / 60)}m`;
}

export interface AttemptRecord {
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
  durationSec: number;
}
