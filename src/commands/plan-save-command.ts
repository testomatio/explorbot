import { getCliName } from '../utils/cli-name.ts';
import { type NextStepSection, printNextSteps, relativeToCwd } from '../utils/next-steps.ts';
import { BaseCommand, type Suggestion } from './base-command.js';

export class PlanSaveCommand extends BaseCommand {
  name = 'plan:save';
  description = 'Save current plan to file';
  suggestions: Suggestion[] = [{ command: 'test', hint: 'launch first test' }];

  async execute(args: string): Promise<void> {
    const plan = this.explorBot.getCurrentPlan();
    if (!plan) {
      throw new Error('No plan to save. Run /plan first.');
    }

    const filename = args.trim() || undefined;
    const savedPath = this.explorBot.savePlan(filename);
    if (!savedPath) return;

    const cli = getCliName();
    const relPlan = relativeToCwd(savedPath);
    const sections: NextStepSection[] = [
      {
        label: 'Plan',
        path: savedPath,
        commands: [
          { label: 'Re-run', command: `${cli} test ${relPlan} 1` },
          { label: 'Run all', command: `${cli} test ${relPlan} *` },
          { label: 'Run range', command: `${cli} test ${relPlan} 1-3` },
          { label: 'Reload', command: `/plan:load ${relPlan}` },
        ],
      },
    ];
    printNextSteps(sections);
  }
}
