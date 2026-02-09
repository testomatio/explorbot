import path from 'node:path';
import { tag } from '../utils/logger.js';
import { BaseCommand } from './base-command.js';

export class PlanSaveCommand extends BaseCommand {
  name = 'plan:save';
  description = 'Save current plan to file';
  suggestions = ['/test - to launch first test'];

  async execute(args: string): Promise<void> {
    const plan = this.explorBot.getCurrentPlan();
    if (!plan) {
      throw new Error('No plan to save. Run /plan first.');
    }

    const filename = args.trim() || undefined;
    const savedPath = this.explorBot.savePlan(filename);

    if (savedPath) {
      const relativePath = path.relative(process.cwd(), savedPath);
      tag('success').log(`Plan saved to: ${relativePath}`);
      tag('info').log(`Run /plan:load ${relativePath} to reload it`);
    }
  }
}
