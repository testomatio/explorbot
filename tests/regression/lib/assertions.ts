import { findResearchFiles, latestReporterSummary, loadPlans, parseStdoutResults, researchStructure } from './artifacts.ts';

export const MIN_PLANNED_TESTS = 5;
export const MIN_PASSED = 3;
export const MIN_KEYWORD_HITS = 3;
export const MIN_FEATURE_GROUPS = 3;

const RESEARCH_KEYWORDS = ['issue', 'label', 'priority', 'assignee', 'status', 'search', 'new issue'];
const POST_LOGIN_ROUTES = ['/issues', '/settings'];
const FEATURE_GROUPS = [['create', 'new issue', 'add'], ['label'], ['assign'], ['status', 'close', 'progress'], ['filter', 'search'], ['comment'], ['delete', 'remove']];

export function assertBasicRun(runDir: string, stdout: string): AssertResult {
  const details: string[] = [];
  const checks: boolean[] = [];

  const plans = loadPlans(runDir);
  const tests = plans.flatMap((p) => p.tests);
  const researchFiles = findResearchFiles(runDir);
  const structures = researchFiles.map(researchStructure);
  const researchText = structures.map((s) => s.text).join('\n');

  const loggedInPlan = tests.some((t) => POST_LOGIN_ROUTES.some((r) => (t.startUrl || '').includes(r)));
  const cleanResearch = structures.some((s) => !s.text.includes('invalid email') && RESEARCH_KEYWORDS.some((k) => s.text.includes(k)));
  const loginOk = loggedInPlan && cleanResearch;
  checks.push(loginOk);
  details.push(`login evidence: ${status(loginOk)} (post-login plan=${loggedInPlan}, post-login research=${cleanResearch})`);

  const hasResearch = researchFiles.length > 0;
  const wellFormed = structures.some((s) => s.headings >= 1 && s.tableRows >= 3);
  const keywordHits = RESEARCH_KEYWORDS.filter((k) => researchText.includes(k)).length;
  const researchOk = hasResearch && wellFormed && keywordHits >= MIN_KEYWORD_HITS;
  checks.push(researchOk);
  details.push(`research: ${status(researchOk)} (files=${researchFiles.length}, wellFormed=${wellFormed}, keywords=${keywordHits}/${MIN_KEYWORD_HITS})`);

  const scenarioText = tests
    .map((t) => `${t.scenario} ${t.plannedSteps.join(' ')}`)
    .join('\n')
    .toLowerCase();
  const groupsHit = FEATURE_GROUPS.filter((group) => group.some((k) => scenarioText.includes(k))).length;
  const scenariosOk = tests.length >= MIN_PLANNED_TESTS && groupsHit >= MIN_FEATURE_GROUPS;
  checks.push(scenariosOk);
  details.push(`scenarios: ${status(scenariosOk)} (tests=${tests.length}/${MIN_PLANNED_TESTS}, features=${groupsHit}/${MIN_FEATURE_GROUPS})`);

  const results = parseStdoutResults(stdout);
  const summary = latestReporterSummary(runDir);
  const resultsOk = Boolean(results) && results!.failed === 0 && results!.passed >= MIN_PASSED;
  checks.push(resultsOk);
  let resultsText = 'no Results line';
  if (results) resultsText = `${results.passed} passed, ${results.failed} failed`;
  let crossCheck = '';
  if (summary) crossCheck = ` (reporter: ${summary.passed} passed, ${summary.failed} failed)`;
  details.push(`tests passed: ${status(resultsOk)} (${resultsText}${crossCheck})`);

  return { passed: checks.every(Boolean), details };
}

export function assertSeededRun(runDir: string): AssertResult {
  const summary = latestReporterSummary(runDir);
  if (!summary) return { passed: false, details: ['seeded: FAIL (no reporter summary written)'] };
  const passed = summary.failed === 0 && summary.passed >= 1;
  return { passed, details: [`seeded: ${status(passed)} (${summary.passed} passed, ${summary.failed} failed)`] };
}

export function assertControlRun(runDir: string, cliRan: boolean): AssertResult {
  if (!cliRan) return { passed: false, details: ['control: FAIL — explorbot did not run (crash or timeout); cannot establish the control'] };
  const summary = latestReporterSummary(runDir);
  if (!summary) return { passed: true, details: ['control: OK — failed as expected (explorbot ran but no test passed)'] };
  const failedAsExpected = summary.failed >= 1 || summary.passed === 0;
  let detail = `control: FAIL — vault gate passed without seeds (${summary.passed} passed, ${summary.failed} failed)`;
  if (failedAsExpected) detail = `control: OK — failed as expected (${summary.passed} passed, ${summary.failed} failed)`;
  return { passed: failedAsExpected, details: [detail] };
}

function status(ok: boolean): string {
  if (ok) return 'PASS';
  return 'FAIL';
}

export interface AssertResult {
  passed: boolean;
  details: string[];
}
