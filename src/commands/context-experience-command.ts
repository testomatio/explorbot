import chalk from 'chalk';
import { basename } from 'node:path';
import { ActionResult } from '../action-result.js';
import { tag } from '../utils/logger.js';
import { BaseCommand } from './base-command.js';

export class ContextExperienceCommand extends BaseCommand {
  name = 'context:experience';
  description = 'Print all matching experience for current page';

  async execute(_args: string): Promise<void> {
    const explorer = this.explorBot.getExplorer();
    const state = explorer.getStateManager().getCurrentState();

    if (!state) {
      throw new Error('No active page');
    }

    const actionResult = ActionResult.fromState(state);
    const experienceTracker = explorer.getStateManager().getExperienceTracker();
    const experience = experienceTracker.getRelevantExperience(actionResult);

    if (experience.length === 0) {
      tag('info').log(`No experience found for: ${actionResult.url}`);
      return;
    }

    const lines: string[] = [];
    lines.push(chalk.bold.cyan(`📁 Experience for ${actionResult.url} (${experience.length} files)`));
    lines.push('');

    for (const exp of experience) {
      lines.push(chalk.yellow(`--- ${basename(exp.filePath)} ---`));
      if (exp.data?.url) {
        lines.push(chalk.gray(`URL: ${exp.data.url}`));
      }
      if (exp.data?.title) {
        lines.push(chalk.gray(`Title: ${exp.data.title}`));
      }
      if (exp.content.trim()) {
        lines.push(exp.content.trim());
      }
      lines.push('');
    }

    tag('multiline').log(lines.join('\n'));
  }
}
