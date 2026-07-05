// Bunosh CLI required to execute tasks from this file
// Get it here => https://buno.sh
import fs from 'node:fs';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const highlight = require('cli-highlight').highlight;
import matter from 'gray-matter';
import yaml from 'js-yaml';
import { chromium } from 'playwright';
import { assertBasicRun, assertControlRun, assertSeededRun } from './tests/regression/lib/assertions.ts';
import { DISCUSSION_CATEGORY, DISCUSSION_MUTATION, DISCUSSION_QUERY, prNumberFromEvent, repoOwnerAndName } from './tests/regression/lib/github.ts';
import { REPORT_MARKER, buildReport } from './tests/regression/lib/report.ts';
import { startFixture } from './tests/regression/fixture/server.ts';
import { parsePlansFromMarkdown } from './src/utils/test-plan-markdown.ts';
import { htmlCombinedSnapshot, htmlTextSnapshot, minifyHtml } from './src/utils/html.js';

const { exec, shell, writeToFile, task, ai } = global.bunosh;

const CLI = resolve('bin/explorbot-cli.ts');
const REG_ROOT = resolve('tests/regression');
const RUNS = join(REG_ROOT, '.runs');
const SEEDS = join(REG_ROOT, 'seeds');
const CONFIG_TEMPLATE = join(REG_ROOT, 'fixture', 'explorbot.config.js');
const VAULT_PLAN = join(SEEDS, 'vault-plan.md');
const VALID_VARIANTS = ['native', 'aria', 'plain', 'random'];
const records = [];

// input/output
const { say, ask, yell } = global.bunosh;

/**
 * 🎉 Hello world command
 */
export async function worktreeCreate(name = '') {
  const worktreeName = name || (await ask('What is feature name?'));

  const newDir = `../explorbot-${worktreeName}`;

  await exec`git worktree add ../explorbot-${worktreeName}`;
  await exec`ln -sf node_modules ${newDir}/node_modules`;

  say(`Created worktree for feature ${worktreeName} in ${newDir}`);
}

/**
 * Print HTML combined file for the given file name
 * @param {file} fileName
 */
export async function htmlCombined(fileName) {
  const html = fs.readFileSync(fileName, 'utf8');
  const combinedHtml = await minifyHtml(htmlCombinedSnapshot(html));
  console.log('----------');
  console.log(highlight(combinedHtml, { language: 'markdown' }));
}

export async function htmlAiText(fileName) {
  const html = fs.readFileSync(fileName, 'utf8');
  if (!html) {
    throw new Error('HTML file not found');
  }
  say(`Transforming HTML to markdown... ${html.length} characters`);
  const combinedHtml = await minifyHtml(htmlCombinedSnapshot(html));
  if (!combinedHtml) {
    throw new Error('HTML has no semantic elements');
  }
  console.log(combinedHtml);
  const result = await ai(`Transform into markdown. Identify headers, footers, asides, special application parts and main contant.
    Content should be in markdown format. If it is content: tables must be tables, lists must be lists. 
    Navigation elements should be represented as standalone blocks after the content.
    Do not summarize content, just transform it into markdown.
    It is important to list all the content text
    If it is link it must be linked
    You can summarize footers/navigation/aside elements. 
    But main conteint should be kept as text and formatted as markdown based on its current markup.

    Break down into sections:

    ## Content Area

    ## Navigation Area

    ## Footer & External Links Area

    Here is HTML:

    ${combinedHtml}
  `);
  console.log(highlight(result.output, { language: 'markdown' }));
}

/**
 * Open a page with Playwright and render accessibility tree in YAML format
 * @param {string} url - URL to open
 */
export async function htmlAccessibility(filename) {
  let targetUrl = filename;

  targetUrl = 'file://' + process.cwd() + '/' + filename;

  say(`Opening ${targetUrl} and analyzing accessibility tree...`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(targetUrl, { waitUntil: 'networkidle' });

    const accessibilityTree = await page.accessibility.snapshot();

    console.log(accessibilityTree);

    // const yamlOutput = yaml.dump(accessibilityTree, {
    //   indent: 2,
    //   lineWidth: 120,
    //   noRefs: true
    // });

    // console.log('----------');
    // console.log(highlight(yamlOutput, { language: 'yaml' }));
  } catch (error) {
    yell(`Error analyzing page: ${error.message}`);
  } finally {
    await browser.close();
  }
}

/**
 * Regression scenario A: fresh explore of the Trackly fixture with real AI.
 * @param {object} options
 * @param {number} [options.retries=2] - Re-runs after a failed attempt
 * @param {string} [options.variant=native] - Widget variant: native|aria|plain|random
 * @param {number} [options.seed=42] - RNG seed for the random variant
 */
export async function regressionBasic(options = { retries: 2, variant: 'native', seed: 42 }) {
  if (!(await requireKey())) return;
  const variant = validateVariant(options.variant);
  if (!variant) return;
  const result = await runBasicScenario(variant, Number(options.seed) || 42, Number(options.retries) || 0);
  writeReportFiles();
  await gate(`Scenario basic (${variant})`, result.passed, `basic (${variant}) failed after ${result.attempts} attempt(s)`);
}

/**
 * Regression scenario B: experience reuse. Control run must fail without seeds; seeded run must pass.
 * @param {object} options
 * @param {number} [options.retries=2] - Re-runs of the seeded direction
 * @param {string} [options.variant=native] - Widget variant: native|aria|plain|random
 * @param {number} [options.seed=42] - RNG seed for the random variant
 */
export async function regressionExperience(options = { retries: 2, variant: 'native', seed: 42 }) {
  if (!(await requireKey())) return;
  const variant = validateVariant(options.variant);
  if (!variant) return;
  const result = await runExperienceScenario(variant, Number(options.seed) || 42, Number(options.retries) || 0);
  writeReportFiles();
  await gate('Scenario experience: control', result.controlPassed, 'control run passed without seeds — vault gate is broken');
  await gate('Scenario experience: seeded', result.seededPassed, 'seeded run failed to pass');
}

/**
 * Run all regression scenarios.
 * @param {object} options
 * @param {number} [options.retries=2]
 * @param {string} [options.variant=native]
 * @param {number} [options.seed=42]
 */
export async function regressionAll(options = { retries: 2, variant: 'native', seed: 42 }) {
  await regressionBasic(options);
  await regressionExperience(options);
}

/**
 * Informational variant matrix. Runs a scenario across variants without gating on assertion outcomes.
 * @param {object} options
 * @param {number} [options.retries=0]
 * @param {string} [options.scenario=basic] - basic|experience
 * @param {string} [options.variants=native,aria,plain] - comma-separated variant list
 * @param {number} [options.seed=42]
 */
export async function regressionVariants(options = { retries: 0, scenario: 'basic', variants: 'native,aria,plain', seed: 42 }) {
  if (!(await requireKey())) return;
  const seed = Number(options.seed) || 42;
  const retries = Number(options.retries) || 0;
  const scenario = options.scenario || 'basic';
  const variants = String(options.variants || 'native,aria,plain').split(',').map((v) => v.trim()).filter(Boolean);
  for (const variant of variants) {
    if (!VALID_VARIANTS.includes(variant)) {
      yell(`Skipping invalid variant: ${variant}`);
      continue;
    }
    if (scenario === 'experience') await runExperienceScenario(variant, seed, retries);
    else await runBasicScenario(variant, seed, retries);
  }
  writeReportFiles();
}

/**
 * Post the regression report as a sticky PR comment or a GitHub Discussion.
 */
export async function regressionReport() {
  const reportPath = join(RUNS, 'report.md');
  if (!existsSync(reportPath)) {
    say('No regression report found; nothing to post.');
    return;
  }
  const event = process.env.GITHUB_EVENT_NAME;
  if (event === 'pull_request') {
    await postPrComment(reportPath);
    return;
  }
  if (event === 'workflow_dispatch') {
    await postDiscussion(reportPath);
    return;
  }
  say(`Not in a PR or dispatch context. Report is at ${reportPath}`);
}

/**
 * Serve the Trackly fixture app for manual inspection.
 * @param {object} options
 * @param {number} [options.port=8899]
 * @param {string} [options.variant=native] - native|aria|plain|random
 * @param {number} [options.seed=42]
 */
export async function regressionServe(options = { port: 8899, variant: 'native', seed: 42 }) {
  const variant = validateVariant(options.variant);
  if (!variant) return;
  const fixture = startFixture({ port: Number(options.port) || 8899, variant, seed: Number(options.seed) || 42 });
  say(`Trackly fixture running at ${fixture.url} (variant=${variant}, seed=${options.seed}).`);
  say('Append ?variant=aria&seed=7 to any page to preview another variant. Press Ctrl+C to stop.');
  await new Promise(() => {});
}

/**
 * No-AI sanity check of the fixture, seeds, and variant rendering.
 */
export async function regressionSmoke() {
  const fixture = startFixture({ port: 0, variant: 'native', seed: 42 });
  const base = fixture.url;

  const anon = await fetch(`${base}/issues`, { redirect: 'manual' });
  await check('anonymous /issues redirects to /login', anon.status === 302 && anon.headers.get('location') === '/login');

  const badLogin = await fetch(`${base}/login`, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ email: 'x@y.z', password: 'nope' }) });
  await check('wrong credentials rejected', badLogin.status === 401);

  const goodLogin = await fetch(`${base}/login`, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ email: 'demo@example.com', password: 'hunter2-fixture' }) });
  const setCookie = goodLogin.headers.get('set-cookie') || '';
  await check('valid credentials set session and redirect', goodLogin.status === 302 && setCookie.includes('trackly_session'));
  const cookie = setCookie.split(';')[0];

  const issues = await (await fetch(`${base}/issues`, { headers: { cookie } })).text();
  await check('authed issue list renders', issues.includes('<table') && issues.includes('New Issue'));
  await check('issue list has no inline create form (drawer only opens on demand)', issues.includes('href="/issues?new=1"') && !issues.includes('id="new-issue-drawer"'));
  const newRedirect = await fetch(`${base}/issues/new`, { headers: { cookie }, redirect: 'manual' });
  await check('legacy /issues/new redirects to the drawer', newRedirect.status === 302 && newRedirect.headers.get('location') === '/issues?new=1');
  const opened = await (await fetch(`${base}/issues?new=1`, { headers: { cookie } })).text();
  await check('drawer opens on ?new=1 with the create form', opened.includes('id="new-issue-drawer"') && opened.includes('name="title"') && opened.includes('action="/issues/new"'));

  const created = await fetch(`${base}/api/issues`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Smoke issue' }) });
  await check('API creates an issue', created.status === 201);
  const apiList = await (await fetch(`${base}/api/issues`, { headers: { cookie } })).json();
  const smokeIssue = apiList.find((i) => i.title === 'Smoke issue');
  await check('API lists the created issue', Boolean(smokeIssue));
  const deleted = await fetch(`${base}/api/issues/${smokeIssue?.id}`, { method: 'DELETE', headers: { cookie } });
  await check('API deletes an issue', deleted.status === 204);
  const invalid = await fetch(`${base}/api/issues`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ title: '' }) });
  await check('API rejects empty title with 422', invalid.status === 422);
  const openapi = await fetch(`${base}/api/openapi.json`);
  await check('OpenAPI document is served', openapi.status === 200);

  const vaultWrong = await (await fetch(`${base}/vault/unlock`, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ code: 'WRONG' }) })).text();
  await check('vault rejects wrong code', vaultWrong.includes('Invalid access code') && !vaultWrong.includes('Vault unlocked'));
  const vaultRight = await (await fetch(`${base}/vault/unlock`, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ code: 'K7-9284-XRAY-TANGO' }) })).text();
  await check('vault unlocks with correct code', vaultRight.includes('Vault unlocked') && vaultRight.includes('Secret documents'));
  fixture.stop();

  const plans = parsePlansFromMarkdown(VAULT_PLAN);
  await check('seed plan parses to one test at /vault', plans.length === 1 && plans[0].tests.length === 1 && plans[0].tests[0].startUrl === '/vault');
  await check('seed plan does not leak the access code', !readFileSync(VAULT_PLAN, 'utf-8').includes('K7-9284'));
  const knowledge = matter(readFileSync(join(SEEDS, 'knowledge', 'login.md'), 'utf-8'));
  await check('login knowledge targets /login', knowledge.data.url === '/login');
  const vaultKnowledge = matter(readFileSync(join(SEEDS, 'knowledge', 'vault.md'), 'utf-8'));
  await check('vault knowledge targets /vault and carries the code', vaultKnowledge.data.url === '/vault' && vaultKnowledge.content.includes('K7-9284-XRAY-TANGO'));
  const experience = matter(readFileSync(join(SEEDS, 'experience', 'vault.md'), 'utf-8'));
  await check('vault experience targets /vault', experience.data.url === '/vault');

  await checkVariants();
}

async function runBasicScenario(variant, seed, retries) {
  const label = `basic (${variant})`;
  const maxAttempts = retries + 1;
  let passed = false;
  let attempts = 0;
  for (let attempt = 1; attempt <= maxAttempts && !passed; attempt++) {
    attempts = attempt;
    const fixture = startFixture({ variant, seed });
    const runDir = prepareRunDir(dirName('basic', variant, seed), attempt);
    cpSync(join(SEEDS, 'knowledge', 'login.md'), join(runDir, 'knowledge', 'login.md'));
    const started = Date.now();
    const res = await shell`timeout 1800 bun ${CLI} explore /issues --headless --max-tests 5 -p ${runDir}`.env(runEnv(fixture.url));
    fixture.stop();
    const outcome = assertBasicRun(runDir, String(res.output || ''));
    records.push({ label, kind: 'gate', attempt, maxAttempts, passed: outcome.passed, durationSec: elapsed(started), details: outcome.details });
    reportAttempt(label, attempt, maxAttempts, outcome);
    passed = outcome.passed;
  }
  return { passed, attempts };
}

async function runExperienceScenario(variant, seed, retries) {
  const controlFixture = startFixture({ variant, seed });
  const controlDir = prepareRunDir(dirName('exp-control', variant, seed), 1);
  const controlStart = Date.now();
  const controlRes = await shell`timeout 720 bun ${CLI} test ${VAULT_PLAN} all --headless -p ${controlDir}`.env(runEnv(controlFixture.url));
  controlFixture.stop();
  const control = assertControlRun(controlDir, !controlRes.hasFailed);
  records.push({ label: 'experience: control', kind: 'control', attempt: 1, maxAttempts: 1, passed: control.passed, durationSec: elapsed(controlStart), details: control.details });
  reportAttempt('experience: control', 1, 1, control);

  const maxAttempts = retries + 1;
  let seededPassed = false;
  for (let attempt = 1; attempt <= maxAttempts && !seededPassed; attempt++) {
    const fixture = startFixture({ variant, seed });
    const runDir = prepareRunDir(dirName('exp-seeded', variant, seed), attempt);
    cpSync(join(SEEDS, 'experience'), join(runDir, 'experience'), { recursive: true });
    cpSync(join(SEEDS, 'knowledge', 'vault.md'), join(runDir, 'knowledge', 'vault.md'));
    const started = Date.now();
    const res = await shell`timeout 720 bun ${CLI} test ${VAULT_PLAN} all --headless -p ${runDir}`.env(runEnv(fixture.url));
    fixture.stop();
    const outcome = assertSeededRun(runDir);
    records.push({ label: 'experience: seeded', kind: 'gate', attempt, maxAttempts, passed: outcome.passed, durationSec: elapsed(started), details: outcome.details });
    reportAttempt('experience: seeded', attempt, maxAttempts, outcome);
    seededPassed = outcome.passed;
  }
  return { controlPassed: control.passed, seededPassed };
}

function prepareRunDir(name, attempt) {
  const dir = join(RUNS, `${name}-a${attempt}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'knowledge'), { recursive: true });
  mkdirSync(join(dir, 'experience'), { recursive: true });
  cpSync(CONFIG_TEMPLATE, join(dir, 'explorbot.config.js'));
  return dir;
}

function writeReportFiles() {
  mkdirSync(RUNS, { recursive: true });
  const markdown = buildReport(records);
  writeFileSync(join(RUNS, 'report.md'), markdown);
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) writeFileSync(summaryPath, `${markdown}\n`, { flag: 'a' });
}

function reportAttempt(label, attempt, maxAttempts, outcome) {
  const verdict = outcome.passed ? 'PASS' : 'FAIL';
  say(`${label} attempt ${attempt}/${maxAttempts}: ${verdict}`);
  for (const detail of outcome.details) say(`  ${detail}`);
}

async function gate(name, passed, failureMessage) {
  await task(name, async () => {
    if (passed) return;
    throw new Error(failureMessage);
  });
}

async function requireKey() {
  const present = Boolean(process.env.OPENROUTER_API_KEY);
  await gate('OPENROUTER_API_KEY present', present, 'OPENROUTER_API_KEY is not set');
  return present;
}

function validateVariant(value) {
  if (VALID_VARIANTS.includes(value)) return value;
  yell(`Invalid variant "${value}". Use one of: ${VALID_VARIANTS.join(', ')}`);
  return null;
}

function dirName(base, variant, seed) {
  if (variant === 'random') return `${base}-random-s${seed}`;
  return `${base}-${variant}`;
}

function elapsed(startMs) {
  return Math.round((Date.now() - startMs) / 1000);
}

function runEnv(url) {
  return { ...process.env, APP_URL: url, NO_COLOR: '1', EXPLORBOT_NO_BANNER: '1' };
}

async function check(name, ok) {
  await gate(name, ok, `${name} — failed`);
}

async function checkVariants() {
  for (const variant of ['native', 'aria', 'plain']) {
    const fixture = startFixture({ port: 0, variant, seed: 42 });
    const login = await fetch(`${fixture.url}/login`, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ email: 'demo@example.com', password: 'hunter2-fixture' }) });
    const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
    const html = await (await fetch(`${fixture.url}/issues?new=1`, { headers: { cookie } })).text();
    fixture.stop();
    if (variant === 'native') await check('native variant renders semantic select', html.includes('multiple') && !html.includes('data-widget="multiselect"'));
    if (variant === 'aria') await check('aria variant renders combobox roles and hidden inputs', html.includes('role="combobox"') && html.includes('data-hidden-inputs'));
    if (variant === 'plain') await check('plain variant renders bare widgets with hidden inputs', html.includes('data-widget="multiselect"') && !html.includes('role="combobox"') && html.includes('data-hidden-inputs'));
  }
}

async function postPrComment(reportPath) {
  const pr = prNumberFromEvent();
  const repo = process.env.GITHUB_REPOSITORY;
  if (!pr || !repo) {
    say('No pull request number available; skipping comment.');
    return;
  }
  const filter = `[.[] | select(.body | contains("${REPORT_MARKER}"))][0].id`;
  const existing = await shell`gh api repos/${repo}/issues/${pr}/comments --paginate --jq ${filter}`;
  const id = String(existing.output || '').trim();
  if (id && id !== 'null') {
    await shell`gh api -X PATCH repos/${repo}/issues/comments/${id} -F body=@${reportPath}`;
    return;
  }
  await shell`gh api -X POST repos/${repo}/issues/${pr}/comments -F body=@${reportPath}`;
}

async function postDiscussion(reportPath) {
  const info = repoOwnerAndName();
  if (!info) {
    say('No repository info available; skipping discussion.');
    return;
  }
  const query = await shell`gh api graphql -f query=${DISCUSSION_QUERY} -F owner=${info.owner} -F name=${info.name}`;
  const data = JSON.parse(String(query.output || '{}'));
  const repoId = data?.data?.repository?.id;
  const category = data?.data?.repository?.discussionCategories?.nodes?.find((n) => n.name === DISCUSSION_CATEGORY);
  if (!repoId || !category) {
    say(`No "${DISCUSSION_CATEGORY}" discussion category found; skipping discussion.`);
    return;
  }
  const sha7 = (process.env.GITHUB_SHA || 'local').slice(0, 7);
  const date = new Date().toISOString().slice(0, 10);
  const title = `Regression ${date} — ${sha7}`;
  await shell`gh api graphql -f query=${DISCUSSION_MUTATION} -F repo=${repoId} -F cat=${category.id} -F title=${title} -F body=@${reportPath}`;
}
