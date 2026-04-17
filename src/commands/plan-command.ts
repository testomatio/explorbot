import path from 'node:path';
import chalk from 'chalk';
import figureSet from 'figures';
import { tag } from '../utils/logger.js';
import { BaseCommand } from './base-command.js';

export class PlanCommand extends BaseCommand {
  name = 'plan';
  description = 'Plan testing for a feature';
  suggestions = ['/test - to launch first test', '/test * - to launch all tests', 'Edit the plan in file and call /plan:reload to update it'];
  options = [
    { flags: '--fresh', description: 'Regenerate plan from scratch' },
    { flags: '--clear', description: 'Clear plan before regenerating' },
    { flags: '--style <name>', description: 'Planning style (normal, curious, psycho, performer)' },
    { flags: '--focus <feature>', description: 'Focus area for test planning' },
  ];

  async execute(args: string): Promise<void> {
    const { opts, args: remaining } = this.parseArgs(args);
    const focus = (opts.focus as string) || remaining.join(' ') || undefined;

    if (opts.clear) {
      this.explorBot.clearPlan();
      tag('success').log('Plan cleared');
    }

    if (focus) {
      tag('info').log(`Planning focus: ${focus}`);
    }

    await this.explorBot.plan(focus, { fresh: !!(opts.fresh || opts.clear), style: opts.style as string });

    const plan = this.explorBot.getCurrentPlan();
    if (!plan?.tests.length) {
      throw new Error('No test scenarios in the current plan.');
    }

    this.printPlanSummary();
    this.updateSuggestions();
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
      console.log(`\n${chalk.bold.cyan(`New test scenarios (${plan.tests.length})`)}`);
      for (let i = 0; i < plan.tests.length; i++) {
        const t = plan.tests[i];
        console.log(`  ${chalk.dim(`${i + 1}.`)} ${chalk.green(figureSet.pointer)} ${t.scenario} ${chalk.dim(`[${t.priority}]`)}`);
      }
    }
  }

  private updateSuggestions(): void {
    this.suggestions = ['/test - to launch first test', '/test * - to launch all tests'];

    const suite = this.explorBot.getSuite();
    if (suite && suite.automatedTestCount > 0) {
      for (const f of suite.getAutomatedTestFiles()) {
        this.suggestions.push(`/rerun ${path.relative(process.cwd(), f)} - re-run automated tests`);
      }
    }

    this.suggestions.push('Edit the plan in file and call /plan:reload to update it');
  }
}
