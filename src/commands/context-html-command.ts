import { ActionResult } from '../action-result.js';
import { tag } from '../utils/logger.js';
import { BaseCommand } from './base-command.js';

export class ContextHtmlCommand extends BaseCommand {
  name = 'context:html';
  description = 'Print combined HTML snapshot for current page';

  async execute(_args: string): Promise<void> {
    const explorer = this.explorBot.getExplorer();
    const manager = explorer.getStateManager();
    const state = manager.getCurrentState();

    if (!state) {
      throw new Error('No active page to snapshot');
    }

    let actionResult = ActionResult.fromState(state);

    if (!actionResult.html || actionResult.html.trim().length < 100) {
      tag('info').log('Capturing fresh page content...');
      actionResult = await explorer.createAction().capturePageState();
    }

    const html = await actionResult.combinedHtml();

    if (!html) {
      throw new Error('No HTML snapshot available for current page');
    }

    tag('html').log(html);
  }
}
