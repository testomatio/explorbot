import chalk from 'chalk';
import { basename } from 'node:path';
import { ActionResult } from '../action-result.js';
import { tag } from '../utils/logger.js';
import { BaseCommand } from './base-command.js';

export class ContextKnowledgeCommand extends BaseCommand {
  name = 'context:knowledge';
  description = 'Print all matching knowledge for current page';

  async execute(_args: string): Promise<void> {
    const explorer = this.explorBot.getExplorer();
    const state = explorer.getStateManager().getCurrentState();

    if (!state) {
      throw new Error('No active page');
    }

    const actionResult = ActionResult.fromState(state);
    const knowledgeTracker = this.explorBot.getKnowledgeTracker();
    const knowledge = knowledgeTracker.getRelevantKnowledge(actionResult);

    if (knowledge.length === 0) {
      tag('info').log(`No knowledge found for: ${actionResult.url}`);
      return;
    }

    const lines: string[] = [];
    lines.push(chalk.bold.cyan(`📚 Knowledge for ${actionResult.url} (${knowledge.length} files)`));
    lines.push('');

    for (const k of knowledge) {
      lines.push(chalk.yellow(`--- ${basename(k.filePath)} ---`));
      lines.push(chalk.gray(`Pattern: ${k.url}`));
      if (k.content.trim()) {
        lines.push(k.content.trim());
      }
      lines.push('');
    }

    tag('multiline').log(lines.join('\n'));
  }
}
