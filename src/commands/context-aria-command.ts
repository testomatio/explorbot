import { tag } from '../utils/logger.js';
import { BaseCommand } from './base-command.js';

export class ContextAriaCommand extends BaseCommand {
  name = 'context:aria';
  description = 'Print full ARIA snapshot for current page';

  async execute(_args: string): Promise<void> {
    const state = this.explorBot.getExplorer().getStateManager().getCurrentState();

    if (!state) {
      throw new Error('No active page to snapshot');
    }

    const ariaSnapshot = state.ariaSnapshot;
    if (!ariaSnapshot) {
      throw new Error('No ARIA snapshot available for current page');
    }

    tag('multiline').log(`ARIA Snapshot:\n\n${ariaSnapshot}`);
  }
}
