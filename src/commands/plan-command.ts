import { existsSync } from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import figureSet from 'figures';
import { getCliName } from '../utils/cli-name.ts';
import { tag } from '../utils/logger.js';
import { type NextStepSection, printNextSteps, relativeToCwd } from '../utils/next-steps.ts';
import { BaseCommand, type Suggestion } from './base-command.js';

export class PlanCommand extends BaseCommand {
  name = 'plan';
  description = 'Plan testing for a feature';
  suggestions: Suggestion[] = [
    { command: 'test', hint: 'launch first test' },
    { command: 'test *', hint: 'launch all tests' },
    { command: 'plan:reload', hint: 'after editing the plan file, reload it' },
  ];
  options = [
    { flags: '--fresh', description: 'Regenerate plan from scratch' },
    { flags: '--clear', description: 'Clear plan before regenerating' },
    { flags: '--append', description: 'Add tests to existing plan file' },
    { flags: '--style <name>', description: 'Planning style (normal, curious, psycho, performer)' },
    { flags: '--focus <feature>', description: 'Focus area for test planning' },
    { flags: '--tests <count>', description: 'Exact number of tests to generate' },
    { flags: '--min-tests <count>', description: 'Minimum number of tests to generate' },
    { flags: '--max-tests <count>', description: 'Maximum number of tests to generate' },
  ];

  async execute(args: string): Promise<void> {
    const { opts, args: remaining } = this.parseArgs(args);
    const focus = (opts.focus as string) || remaining.join(' ') || undefined;

    if (opts.clear) {
      this.explorBot.clearPlan();
      tag('success').log('Plan cleared');
    }

    if (opts.append) {
      const existingPlanPath = path.join(this.explorBot.getPlansDir(), this.explorBot.generatePlanFilename());
      if (existsSync(existingPlanPath)) this.explorBot.loadPlan(existingPlanPath);
    }

    if (focus) {
      tag('info').log(`Planning focus: ${focus}`);
    }

    const testsCount = opts.tests ? Number.parseInt(opts.tests as string, 10) : undefined;
    const minTests = testsCount ?? (opts.minTests ? Number.parseInt(opts.minTests as string, 10) : undefined);
    const maxTests = testsCount ?? (opts.maxTests ? Number.parseInt(opts.maxTests as string, 10) : undefined);

    await this.explorBot.plan(focus, { fresh: !!(opts.fresh || opts.clear), style: opts.style as string, minTests, maxTests });

    const plan = this.explorBot.getCurrentPlan();
    if (!plan?.tests.length) {
      throw new Error('No test scenarios in the current plan.');
    }

    this.printPlanSummary();
    this.updateSuggestions();
    this.printNextSteps();
  }

  static planSection(planPath: string, cliSuffix = ''): NextStepSection {
    const cli = getCliName();
    const planName = path.basename(planPath, '.md');
    return {
      label: 'Plan',
      path: planPath,
      commands: [
        { label: 'Run all tests', command: `${cli} test ${planName}${cliSuffix}` },
        { label: 'Run one test', command: `${cli} test ${planName} 1${cliSuffix}` },
        { label: 'Run a range', command: `${cli} test ${planName} 1-3${cliSuffix}` },
      ],
    };
  }

  private printNextSteps(): void {
    const savedPath = this.explorBot.lastSavedPlanPath;
    if (!savedPath) return;

    const cli = getCliName();
    const cliSuffix = this.cliSuffix();
    const section = PlanCommand.planSection(savedPath, cliSuffix);
    section.commands?.push({ label: 'Reload', command: `/plan:load ${path.basename(savedPath, '.md')}` });
    const sections: NextStepSection[] = [section];

    const suite = this.explorBot.getSuite();
    const files = suite && suite.automatedTestCount > 0 ? suite.getAutomatedTestFiles() : [];
    if (files.length > 0) {
      const commands = files.map((f) => ({ label: '', command: `${cli} rerun ${relativeToCwd(f)}${cliSuffix}` }));
      sections.push({
        label: `Automated tests (${files.length})`,
        commands,
      });
    }

    printNextSteps(sections);
  }

  private cliSuffix(): string {
    const options = this.explorBot.getOptions();
    let suffix = '';
    if (options.path) suffix += ` --path ${options.path}`;
    if (options.session) suffix += ' --session';
    return suffix;
  }

  private printPlanSummary(): void {
    const suite = this.explorBot.getSuite();
    const plan = this.explorBot.getCurrentPlan();

    if (suite && suite.automatedTestCount > 0) {
      const names = suite.getAutomatedTestNames();
      console.log(`\n${chalk.bold.cyan(`Already implemented (${names.length} tests)`)}`);
      for (let i = 0; i < names.length; i++) {
        console.log(`  ${chalk.dim(`${i + 1}.`)} ${chalk.green(figureSet.pointer)} ${names[i]}`);
      }
    }

    if (plan?.tests.length) {
      console.log(`\n${chalk.bold.cyan(`New test scenarios (${plan.tests.length})`)}\n`);
      for (let i = 0; i < plan.tests.length; i++) {
        const t = plan.tests[i];
        console.log(`  ${chalk.cyan(`${i + 1}.`)} ${t.scenario}`);
      }
    }
  }

  private updateSuggestions(): void {
    this.suggestions = [
      { command: 'test', hint: 'launch first test' },
      { command: 'test *', hint: 'launch all tests' },
    ];

    const suite = this.explorBot.getSuite();
    if (suite && suite.automatedTestCount > 0) {
      for (const f of suite.getAutomatedTestFiles()) {
        this.suggestions.push({ command: `rerun ${path.relative(process.cwd(), f)}`, hint: 're-run automated tests' });
      }
    }

    this.suggestions.push({ command: 'plan:reload', hint: 'after editing the plan file, reload it' });
  }
}
