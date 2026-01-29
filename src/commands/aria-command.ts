import { tag } from '../utils/logger.js';
import { BaseCommand } from './base-command.js';

export class AriaCommand extends BaseCommand {
  name = 'aria';
  description = 'Print ARIA snapshot for current page';

  async execute(args: string): Promise<void> {
    const state = this.explorBot.getExplorer().getStateManager().getCurrentState();

    if (!state) {
      throw new Error('No active page to snapshot');
    }

    const ariaSnapshot = state.ariaSnapshot;
    if (!ariaSnapshot) {
      throw new Error('No ARIA snapshot available for current page');
    }

    const wantsShort = args.split(/\s+/).includes('short') || args.includes('--short');
    if (wantsShort) {
      tag('multiline').log(`ARIA Snapshot:\n\n${ariaSnapshot}`);
      return;
    }

    tag('snapshot').log(`ARIA Snapshot:\n\n${ariaSnapshot}`);
  }
}
