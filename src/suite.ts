import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { Reflection } from '@codeceptjs/reflection';
import { ConfigParser } from './config.ts';
import { normalizeUrl } from './state-manager.ts';
import { parsePlanFromMarkdown } from './utils/test-plan-markdown.ts';
import { createDebug } from './utils/logger.ts';

const debugLog = createDebug('explorbot:suite');

export class Suite {
  readonly url: string;
  private _automatedTests: AutomatedTest[] | null = null;
  private _plannedScenarios: string[] | null = null;

  constructor(url: string) {
    this.url = url;
  }

  getAutomatedTests(): AutomatedTest[] {
    if (this._automatedTests !== null) return this._automatedTests;
    this._automatedTests = this.loadAutomatedTests();
    return this._automatedTests;
  }

  getPlannedScenarios(): string[] {
    if (this._plannedScenarios !== null) return this._plannedScenarios;
    this._plannedScenarios = this.loadPlannedScenarios();
    return this._plannedScenarios;
  }

  getActiveScenarioTitles(): Set<string> {
    return new Set(
      this.getAutomatedTests()
        .filter((t) => !t.pending)
        .map((t) => t.title.toLowerCase())
    );
  }

  get automatedTestCount(): number {
    return this.getAutomatedTests().filter((t) => !t.pending).length;
  }

  getAutomatedTestNames(): string[] {
    return this.getAutomatedTests()
      .filter((t) => !t.pending)
      .map((t) => t.title);
  }

  getAutomatedTestFiles(): string[] {
    return [...new Set(this.getAutomatedTests().map((t) => t.file))];
  }

  private loadAutomatedTests(): AutomatedTest[] {
    const testsDir = ConfigParser.getInstance().getTestsDir();
    if (!existsSync(testsDir)) return [];

    const jsFiles = readdirSync(testsDir)
      .filter((f) => f.endsWith('.js'))
      .map((f) => path.resolve(testsDir, f));

    const results: AutomatedTest[] = [];

    for (const filePath of jsFiles) {
      const parsed = this.parseTestFile(filePath);
      if (!parsed) continue;
      if (normalizeUrl(parsed.url) !== normalizeUrl(this.url)) continue;
      results.push(...parsed.tests);
    }

    return results;
  }

  private parseTestFile(filePath: string): { url: string; tests: AutomatedTest[] } | null {
    try {
      const scanned = Reflection.scanFile(filePath);
      if (!scanned.suites?.length) return null;

      const content = readFileSync(filePath, 'utf-8');

      const suiteRef = Reflection.forSuite(scanned.suites[0]);
      const beforeHooks = suiteRef.findHook('Before');
      if (!beforeHooks?.length) return null;

      const hookBody = content.slice(beforeHooks[0].range.start, beforeHooks[0].range.end);
      const match = hookBody.match(/I\.amOnPage\(['"]([^'"]+)['"]\)/);
      if (!match) return null;

      const lines = content.split('\n');
      const tests = (scanned.tests || []).map((t: any) => {
        const line = lines[t.line - 1] || '';
        const pending = line.includes('Scenario.skip') || line.includes('Scenario.todo');
        return { title: t.title, pending, file: filePath };
      });

      return { url: match[1], tests };
    } catch (err: any) {
      debugLog('Failed to parse test file %s: %s', filePath, err.message);
      return null;
    }
  }

  private loadPlannedScenarios(): string[] {
    try {
      const plansDir = ConfigParser.getInstance().getPlansDir();
      if (!existsSync(plansDir)) return [];

      const mdFiles = readdirSync(plansDir)
        .filter((f) => f.endsWith('.md'))
        .map((f) => path.resolve(plansDir, f));

      const scenarios: string[] = [];

      for (const filePath of mdFiles) {
        const plan = parsePlanFromMarkdown(filePath);
        if (!plan.url) continue;
        if (normalizeUrl(plan.url) !== normalizeUrl(this.url)) continue;
        for (const test of plan.tests) {
          scenarios.push(test.scenario);
        }
      }

      return scenarios;
    } catch (err: any) {
      debugLog('Failed to load planned scenarios: %s', err.message);
      return [];
    }
  }
}

interface AutomatedTest {
  title: string;
  pending: boolean;
  file: string;
}
