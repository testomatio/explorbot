import { tag } from '../utils/logger.js';
import { BaseCommand } from './base-command.js';

export class PathCommand extends BaseCommand {
  name = 'path';
  description = 'Display ASCII graph of navigation paths during the session';

  async execute(_args: string): Promise<void> {
    const stateManager = this.explorBot.getExplorer().getStateManager();
    const history = stateManager.getStateHistory();

    if (history.length === 0) {
      tag('multiline').log('No navigation history yet.');
      return;
    }

    const visited: Array<{ title: string; url: string }> = [];
    const seenUrls = new Set<string>();

    for (const transition of history) {
      const state = transition.toState;
      const url = state.url || '/';

      if (seenUrls.has(url)) {
        continue;
      }

      seenUrls.add(url);
      const title = state.h1 || state.title || 'Untitled';
      visited.push({ title, url });
    }

    if (visited.length === 0) {
      tag('multiline').log('No unique paths visited.');
      return;
    }

    const lines: string[] = [];
    lines.push(`Navigation Path (${visited.length} unique pages):\n`);

    for (let i = 0; i < visited.length; i++) {
      const { title, url } = visited[i];
      lines.push(title);
      lines.push(url);

      if (i < visited.length - 1) {
        lines.push('   ↓');
      }
    }

    tag('multiline').log(lines.join('\n'));
  }
}
