import { htmlTextSnapshot } from '../utils/html.js';
import { tag } from '../utils/logger.js';
import { BaseCommand } from './base-command.js';

export class HtmlCommand extends BaseCommand {
  name = 'html';
  description = 'Print HTML snapshot for current page';

  async execute(args: string): Promise<void> {
    const explorer = this.explorBot.getExplorer();
    const manager = explorer.getStateManager();
    const state = manager.getCurrentState();

    if (!state) {
      throw new Error('No active page to snapshot');
    }

    let html = state.html;
    if (!html && state.htmlFile) {
      html = manager.loadHtmlFromFile(state.htmlFile) || '';
    }

    if (!html || html.trim().length < 100) {
      tag('info').log('Capturing fresh page content...');
      const actionResult = await explorer.createAction().capturePageState();
      html = actionResult.html;
    }

    if (!html) {
      throw new Error('No HTML snapshot available for current page');
    }

    const wantsFull = args.split(/\s+/).includes('full') || args.includes('--full');
    if (!wantsFull) {
      tag('html').log(html);
      return;
    }

    const markdown = htmlTextSnapshot(html);
    tag('snapshot').log(`HTML Content:\n\n${markdown}`);
  }
}
