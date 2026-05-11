import figureSet from 'figures';
import { getStyles } from '../ai/planner/styles.js';
import { outputPath } from '../config.js';
import { normalizeUrl } from '../state-manager.js';
import { Stats } from '../stats.js';
import { type Plan, type Test, TestResult } from '../test-plan.js';
import { getCliName } from '../utils/cli-name.ts';
import { ErrorPageError } from '../utils/error-page.ts';
import { tag } from '../utils/logger.js';
import { jsonToTable } from '../utils/markdown-parser.js';
import { type NextStepSection, printNextSteps, relativeToCwd } from '../utils/next-steps.ts';
import { safeFilename } from '../utils/strings.ts';
import { BaseCommand, type Suggestion } from './base-command.js';

const MAX_SUB_PAGE_ATTEMPTS = 30;
const PRIORITY_ORDER: Record<string, number> = { critical: 0, important: 1, high: 2, normal: 3, low: 4 };

export class ExploreCommand extends BaseCommand {
  name = 'explore';
  description = 'Start web exploration';
  options = [
    { flags: '--max-tests <number>', description: 'Maximum number of tests to run' },
    { flags: '--focus <feature>', description: 'Focus area for exploration' },
    { flags: '--configure <spec>', description: 'Reuse spec: keys new|from|style|subpages|pick_by|priority, e.g. "new:25%;pick_by=random;priority=critical,high"' },
    { flags: '--dry-run', description: 'Mark picked tests as skipped without executing or generating new ones' },
  ];
  suggestions: Suggestion[] = [
    { command: 'navigate <page>', hint: 'go to another page' },
    { command: 'research', hint: 'analyze current page' },
    { command: 'plan <feature>', hint: 'plan testing' },
  ];

  maxTests?: number;
  dryRun = false;
  private testsRun = 0;
  private completedPlans: Plan[] = [];
  private failedSubPages = new Set<string>();
  private oldTestRefs = new Set<Test>();
  private priorityFilter?: Set<string>;

  async execute(args: string): Promise<void> {
    const { opts, args: remaining } = this.parseArgs(args);
    if (opts.maxTests) {
      this.maxTests = Number.parseInt(opts.maxTests as string, 10);
    }

    const feature = (opts.focus as string) || remaining.join(' ') || undefined;
    const cfg = this.parseConfigure(opts.configure as string | undefined);
    if (cfg.priorities) this.priorityFilter = new Set(cfg.priorities);
    if (opts.dryRun) this.dryRun = true;
    if (this.dryRun) tag('info').log('Dry-run mode: planner runs to discover new tests; test execution is skipped');
    Stats.mode ??= 'explore';
    Stats.focus ??= feature;
    const mainUrl = this.explorBot.getExplorer().getStateManager().getCurrentState()?.url;

    if (cfg.enabled) {
      await this.runReuseMode(mainUrl, feature, cfg);
    } else {
      await this.runFreshMode(mainUrl, feature, cfg.styles);
    }

    const mainPlan = this.completedPlans[0];
    if (mainPlan) this.explorBot.setCurrentPlan(mainPlan);
    if (this.dryRun) {
      this.printResults();
      return;
    }
    if (mainUrl) await this.explorBot.visit(mainUrl);
    const savedPath = this.explorBot.savePlans(this.completedPlans);
    this.printResults();
    await this.explorBot.printSessionAnalysis();
    this.printNextSteps(savedPath);
  }

  private originLabel(test: Test): string {
    return this.oldTestRefs.has(test) ? 'OLD' : 'NEW';
  }

  private printPreview(label: string, tests: Test[]): void {
    if (tests.length === 0) return;
    const lines = [label];
    for (let i = 0; i < tests.length; i++) {
      const t = tests[i];
      lines.push(`  ${String(i + 1).padStart(2)}. [${this.originLabel(t)}] [${t.priority.padEnd(9)}] ${t.scenario}`);
    }
    tag('multiline').log(lines.join('\n'));
  }

  private async runFreshMode(mainUrl: string | undefined, feature: string | undefined, styles?: string[]): Promise<void> {
    await this.runAllStyles(mainUrl, feature, undefined, undefined, styles);
    const mainPlan = this.explorBot.getCurrentPlan();
    if (!mainPlan) return;
    this.completedPlans.push(mainPlan);

    if (feature || this.isLimitReached()) return;

    await this.discoverNewSubPages(mainPlan, mainUrl, styles, new Set());
  }

  private async runReuseMode(mainUrl: string | undefined, feature: string | undefined, cfg: ConfigureSpec): Promise<void> {
    const filename = cfg.fromPath || this.explorBot.generatePlanFilename(feature);

    let loadedPlans: Plan[] = [];
    try {
      loadedPlans = this.explorBot.loadPlans(filename);
    } catch (err) {
      tag('warning').log(`Reuse plan not found (${err instanceof Error ? err.message : err}); falling back to fresh planning`);
      await this.runFreshMode(mainUrl, feature, cfg.styles);
      return;
    }

    if (loadedPlans.length === 0) {
      tag('warning').log('Reuse plan empty; falling back to fresh planning');
      await this.runFreshMode(mainUrl, feature, cfg.styles);
      return;
    }

    const mainPlan = loadedPlans[0];
    const subPlans = loadedPlans.slice(1);

    const totalCap = this.maxTests ?? Number.POSITIVE_INFINITY;
    let newQuota = Number.POSITIVE_INFINITY;
    let oldQuota = Number.POSITIVE_INFINITY;
    if (Number.isFinite(totalCap)) {
      newQuota = Math.round(totalCap * cfg.newRatio);
      oldQuota = Math.max(0, totalCap - newQuota);
    }

    for (const p of loadedPlans) {
      for (const t of p.tests) this.oldTestRefs.add(t);
    }

    const allOldTests = loadedPlans.flatMap((p) => p.tests.filter((t) => t.status === 'pending'));
    let matchingOldTests: Test[] = allOldTests;
    if (cfg.styles) {
      matchingOldTests = matchingOldTests.filter((t) => !t.style || cfg.styles!.includes(t.style));
    }
    if (this.priorityFilter) {
      matchingOldTests = matchingOldTests.filter((t) => this.priorityFilter!.has(t.priority));
    }
    const pickBy = cfg.pickBy ?? 'priority';
    const orderedOldTests = matchingOldTests.slice();
    if (pickBy === 'priority') {
      orderedOldTests.sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99));
    } else if (pickBy === 'random') {
      for (let i = orderedOldTests.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [orderedOldTests[i], orderedOldTests[j]] = [orderedOldTests[j], orderedOldTests[i]];
      }
    }

    let pickCount = orderedOldTests.length;
    if (Number.isFinite(oldQuota)) pickCount = Math.min(oldQuota, orderedOldTests.length);
    const picked = orderedOldTests.slice(0, pickCount);
    const pickedSet = new Set(picked);

    for (const t of allOldTests) {
      if (!pickedSet.has(t)) t.enabled = false;
    }

    let newQuotaLabel = 'unlimited';
    if (Number.isFinite(newQuota)) newQuotaLabel = String(newQuota);
    let priorityNote = '';
    if (this.priorityFilter) priorityNote = `, priority=[${[...this.priorityFilter].join(',')}]`;
    tag('info').log(`Reuse: loaded ${allOldTests.length} old test(s), running ${picked.length} (pick_by=${pickBy}${priorityNote}), reserving ${newQuotaLabel} for new`);

    const planner = this.explorBot.agentPlanner();
    for (const p of loadedPlans) planner.registerPlanInSession(p);

    this.completedPlans.push(...loadedPlans);

    this.printPreview(`Picked old tests (${picked.length}):`, picked);

    let currentPlanRef: Plan | undefined;
    for (const test of picked) {
      if (this.isLimitReached()) break;
      const owningPlan = test.plan;
      if (owningPlan && owningPlan !== currentPlanRef) {
        this.explorBot.setCurrentPlan(owningPlan);
        if (owningPlan.url && !this.dryRun) await this.explorBot.visit(owningPlan.url);
        currentPlanRef = owningPlan;
      }
      await this.runOneTest(test);
    }

    if (this.isLimitReached() || newQuota <= 0) return;

    const subpagesMode = cfg.subpages || 'both';

    if (mainUrl && !this.dryRun) await this.explorBot.visit(mainUrl);
    await this.replanAndRun(mainUrl, feature, mainPlan, cfg.styles);

    if (this.isLimitReached()) return;

    if (subpagesMode === 'same' || subpagesMode === 'both') {
      for (const subPlan of subPlans) {
        if (this.isLimitReached()) break;
        if (!subPlan.url) continue;
        try {
          if (!this.dryRun) await this.explorBot.visit(subPlan.url);
          await this.replanAndRun(subPlan.url, undefined, subPlan, cfg.styles);
        } catch (err) {
          this.failedSubPages.add(normalizeUrl(subPlan.url));
          tag('warning').log(`Sub-page re-planning failed: ${err instanceof Error ? err.message : err}`);
        }
      }
    }

    if (this.isLimitReached()) return;

    if (subpagesMode === 'new' || subpagesMode === 'both') {
      const knownUrls = new Set<string>();
      for (const p of loadedPlans) {
        if (p.url) knownUrls.add(normalizeUrl(p.url));
      }
      await this.discoverNewSubPages(mainPlan, mainUrl, cfg.styles, knownUrls);
    }
  }

  private async discoverNewSubPages(mainPlan: Plan, mainUrl: string | undefined, styles: string[] | undefined, knownUrls: Set<string>): Promise<void> {
    const planner = this.explorBot.agentPlanner();
    let attempts = 0;
    while (attempts < MAX_SUB_PAGE_ATTEMPTS) {
      attempts++;
      if (this.isLimitReached()) break;

      const candidates = planner.collectSubPageCandidates(mainPlan, mainUrl || '/').filter((c) => {
        const norm = normalizeUrl(c.url);
        return !this.failedSubPages.has(norm) && !knownUrls.has(norm);
      });
      if (candidates.length === 0) break;

      const pick = await planner.pickNextSubPage(candidates);
      if (!pick) break;

      tag('info').log(`Exploring sub-page: ${pick.url} (${pick.reason})`);
      try {
        await this.explorBot.visit(pick.url);
        await this.runAllStyles(pick.url, undefined, mainPlan, this.completedPlans, styles);
        const subPlan = this.explorBot.getCurrentPlan();
        if (subPlan && !this.completedPlans.includes(subPlan)) {
          this.completedPlans.push(subPlan);
        }
        knownUrls.add(normalizeUrl(pick.url));
      } catch (err) {
        this.failedSubPages.add(normalizeUrl(pick.url));
        tag('warning').log(`Sub-page exploration failed: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  private async replanAndRun(pageUrl: string | undefined, feature: string | undefined, existingPlan: Plan, styles?: string[]): Promise<void> {
    const styleList = styles ?? Object.keys(getStyles());
    for (const style of styleList) {
      if (this.isLimitReached()) break;
      this.explorBot.setCurrentPlan(existingPlan);
      const opts: { fresh: boolean; style: string; completedPlans?: Plan[]; noSave?: boolean } = { fresh: false, style, completedPlans: this.completedPlans };
      if (this.dryRun) opts.noSave = true;
      await this.planWithRetry(feature, opts, pageUrl);
      await this.runPendingTests();
    }
  }

  private async runAllStyles(pageUrl?: string, feature?: string, parentPlan?: Plan, completedPlans?: Plan[], styles?: string[]): Promise<void> {
    const styleList = styles ?? Object.keys(getStyles());
    let fresh = true;
    for (const style of styleList) {
      if (!fresh && pageUrl && !this.dryRun) {
        await this.explorBot.visit(pageUrl);
      }
      const opts: { fresh: boolean; style: string; extend?: Plan; completedPlans?: Plan[]; noSave?: boolean } = { fresh, style, completedPlans };
      if (fresh && parentPlan) opts.extend = parentPlan;
      if (this.dryRun) opts.noSave = true;
      await this.planWithRetry(feature, opts, pageUrl);
      await this.runPendingTests();
      fresh = false;
    }
  }

  private async planWithRetry(feature: string | undefined, opts: { fresh: boolean; style: string; extend?: Plan; completedPlans?: Plan[]; noSave?: boolean }, pageUrl?: string): Promise<void> {
    const before = new Set(this.explorBot.getCurrentPlan()?.tests ?? []);

    await this.explorBot.plan(feature, opts);
    if (this.explorBot.lastPlanError) {
      if (this.explorBot.lastPlanError instanceof ErrorPageError) {
        throw this.explorBot.lastPlanError;
      }
      tag('info').log(`Retrying planning style '${opts.style}'...`);
      if (pageUrl && !this.dryRun) await this.explorBot.visit(pageUrl);
      await this.explorBot.plan(feature, opts);
      if (this.explorBot.lastPlanError) {
        tag('warning').log(`Planning style '${opts.style}' failed after retry, skipping`);
        return;
      }
    }

    const planAfter = this.explorBot.getCurrentPlan();
    if (!planAfter) return;
    const added = planAfter.tests.filter((t) => !before.has(t));
    if (added.length === 0) return;
    const urlNote = pageUrl ? ` for ${pageUrl}` : '';
    this.printPreview(`Planner added ${added.length} new test(s) [style=${opts.style}]${urlNote}:`, added);
  }

  private parseConfigure(raw: string | undefined): ConfigureSpec {
    const cfg: ConfigureSpec = { enabled: false, newRatio: 1.0 };
    if (!raw) return cfg;

    const allStyles = Object.keys(getStyles());
    const validSubpages = new Set(['none', 'same', 'new', 'both']);
    let hasReuseSignal = false;

    for (const pair of raw.split(';')) {
      const trimmed = pair.trim();
      if (!trimmed) continue;
      const sepMatch = trimmed.match(/^([^:=]+)\s*[:=]\s*(.*)$/);
      if (!sepMatch) {
        tag('warning').log(`Ignoring malformed configure pair: ${trimmed}`);
        continue;
      }
      const key = sepMatch[1].trim().toLowerCase();
      const value = sepMatch[2].trim();

      if (key === 'new') {
        const ratio = parseRatio(value);
        if (ratio == null) {
          tag('warning').log(`Ignoring invalid 'new' value: ${value}`);
          continue;
        }
        cfg.newRatio = ratio;
        hasReuseSignal = true;
        continue;
      }
      if (key === 'from') {
        cfg.fromPath = value;
        hasReuseSignal = true;
        continue;
      }
      if (key === 'style' || key === 'styles') {
        const requested = value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        const valid: string[] = [];
        for (const s of requested) {
          if (allStyles.includes(s)) {
            valid.push(s);
            continue;
          }
          tag('warning').log(`Unknown planning style: ${s}`);
        }
        if (valid.length) cfg.styles = valid;
        continue;
      }
      if (key === 'subpages') {
        if (!validSubpages.has(value)) {
          tag('warning').log(`Ignoring invalid 'subpages' value: ${value}`);
          continue;
        }
        cfg.subpages = value as ConfigureSpec['subpages'];
        continue;
      }
      if (key === 'pick_by' || key === 'pickby' || key === 'pick-by') {
        if (value === 'priority' || value === 'random' || value === 'index') {
          cfg.pickBy = value;
          continue;
        }
        tag('warning').log(`Ignoring invalid 'pick_by' value: ${value} (use priority|random|index)`);
        continue;
      }
      if (key === 'priority' || key === 'priorities') {
        const requested = value
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);
        const valid: string[] = [];
        for (const p of requested) {
          if (p in PRIORITY_ORDER) {
            valid.push(p);
            continue;
          }
          tag('warning').log(`Unknown priority: ${p} (use ${Object.keys(PRIORITY_ORDER).join('|')})`);
        }
        if (valid.length) cfg.priorities = valid;
        continue;
      }
      tag('warning').log(`Unknown configure key: ${key}`);
    }

    cfg.enabled = hasReuseSignal;
    return cfg;
  }

  private printResults(): void {
    const allTests = this.completedPlans.flatMap((plan) => plan.tests.filter((t) => t.startTime != null).map((test) => ({ test, planTitle: plan.title }))).sort((a, b) => (a.test.startTime ?? 0) - (b.test.startTime ?? 0));

    if (allTests.length === 0) return;

    const hasSubPages = this.completedPlans.length > 1;
    const hasOrigin = this.oldTestRefs.size > 0;
    const rows = allTests.map(({ test, planTitle }, index) => {
      const durationMs = test.getDurationMs();
      const duration = durationMs != null ? `${(durationMs / 1000).toFixed(1)}s` : '-';
      let status = 'failed';
      if (test.isSuccessful) status = 'passed';
      else if (test.isSkipped) status = 'skipped';
      const row: Record<string, string> = {
        '#': String(index + 1),
        Status: status,
        Title: test.scenario.replace(/\|/g, '-'),
        Priority: test.priority,
        Time: duration,
        Steps: String(Object.keys(test.notes).length),
      };
      if (hasOrigin) {
        row.Origin = this.originLabel(test);
      }
      if (hasSubPages) {
        row.Plan = planTitle;
      }
      return row;
    });
    const columns = ['#', 'Status', 'Title', 'Priority', 'Time', 'Steps'];
    if (hasOrigin) columns.push('Origin');
    if (hasSubPages) columns.push('Plan');
    tag('multiline').log(jsonToTable(rows, columns));
    tag('info').log(`${figureSet.tick} ${allTests.length} tests completed`);
  }

  private printNextSteps(savedPlanPath?: string | null): void {
    const cli = getCliName();
    const sections: NextStepSection[] = [];

    if (savedPlanPath) {
      const relPlan = relativeToCwd(savedPlanPath);
      sections.push({
        label: 'Plan',
        path: savedPlanPath,
        commands: [
          { label: 'Re-run', command: `${cli} test ${relPlan} 1` },
          { label: 'Run all', command: `${cli} test ${relPlan} *` },
          { label: 'Run range', command: `${cli} test ${relPlan} 1-3` },
        ],
      });
    }

    const savedFiles = this.explorBot.agentHistorian().getSavedFiles();
    const screencasts = savedFiles.filter((f) => f.endsWith('.webm'));
    const testFiles = savedFiles.filter((f) => !f.endsWith('.webm'));

    if (testFiles.length > 0) {
      const commands = testFiles.map((f) => ({ label: '', command: `${cli} rerun ${relativeToCwd(f)}` }));
      commands.push({ label: 'List tests', command: `${cli} runs` });
      sections.push({
        label: `Generated tests (${testFiles.length})`,
        commands,
      });
    }

    if (screencasts.length > 0) {
      const commands = screencasts.map((f) => ({ label: '', command: relativeToCwd(f) }));
      const screencastDir = relativeToCwd(outputPath('screencasts'));
      const planSlugs = [...new Set(this.completedPlans.map((p) => safeFilename(p.title)).filter(Boolean))];
      for (const slug of planSlugs) {
        commands.push({ label: 'Browse plan', command: `ls ${screencastDir}/${slug}-*` });
      }
      sections.push({
        label: `Screencasts (${screencasts.length})`,
        commands,
      });
    }

    printNextSteps(sections);
  }

  private isLimitReached(): boolean {
    return this.maxTests != null && this.testsRun >= this.maxTests;
  }

  private async runPendingTests(): Promise<void> {
    const plan = this.explorBot.getCurrentPlan();
    if (!plan) return;
    if (this.priorityFilter) {
      for (const t of plan.getPendingTests()) {
        if (!this.priorityFilter.has(t.priority)) t.enabled = false;
      }
    }
    for (const test of plan.getPendingTests()) {
      if (this.isLimitReached()) break;
      await this.runOneTest(test);
    }
  }

  private async runOneTest(test: Test): Promise<void> {
    if (this.dryRun) {
      test.start();
      test.finish(TestResult.SKIPPED);
    } else {
      await this.explorBot.agentTester().test(test);
    }
    this.testsRun++;
  }
}

interface ConfigureSpec {
  enabled: boolean;
  newRatio: number;
  fromPath?: string;
  styles?: string[];
  subpages?: 'none' | 'same' | 'new' | 'both';
  pickBy?: 'priority' | 'random' | 'index';
  priorities?: string[];
}

function parseRatio(s: string): number | null {
  const trimmed = s.trim();
  if (!trimmed) return null;
  if (trimmed.endsWith('%')) {
    const n = Number.parseFloat(trimmed.slice(0, -1));
    if (Number.isNaN(n) || n < 0 || n > 100) return null;
    return n / 100;
  }
  const n = Number.parseFloat(trimmed);
  if (Number.isNaN(n) || n < 0 || n > 1) return null;
  return n;
}
