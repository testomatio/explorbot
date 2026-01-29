import { ActionResult } from '../action-result.js';
import { tag } from '../utils/logger.js';
import { BaseCommand } from './base-command.js';

export class DataCommand extends BaseCommand {
  name = 'data';
  description = 'Extract structured data from current page';

  async execute(_args: string): Promise<void> {
    const explorer = this.explorBot.getExplorer();
    const state = explorer.getStateManager().getCurrentState();

    if (!state) {
      throw new Error('No active page to extract data from');
    }

    const actionResult = ActionResult.fromState(state);

    if (!actionResult.html || actionResult.html.trim().length < 100) {
      tag('info').log('Capturing fresh page content...');
      const freshResult = await explorer.createAction().capturePageState();
      const table = await this.explorBot.agentResearcher().extractData(freshResult);
      tag('multiline').log(table);
      return;
    }

    const table = await this.explorBot.agentResearcher().extractData(state);
    tag('multiline').log(table);
  }
}
