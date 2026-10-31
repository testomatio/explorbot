import path from 'node:path';
import { printNextSteps } from '../utils/next-steps.ts';
import { PlanCommand } from './plan-command.js';
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

    const section = PlanCommand.planSection(savedPath);
    section.commands?.push({ label: 'Reload', command: `/plan:load ${path.basename(savedPath, '.md')}` });
    printNextSteps([section]);
  }
}
