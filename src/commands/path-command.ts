import type { Link } from '../state-manager.js';
import { tag } from '../utils/logger.js';
import { BaseCommand } from './base-command.js';

interface VisitedPage {
  title: string;
  url: string;
  links: Link[];
}

export class PathCommand extends BaseCommand {
  name = 'path';
  description = 'Display ASCII graph of navigation paths during the session';
  options = [{ flags: '--links', description: 'Show outgoing links from each page' }];

  async execute(args: string): Promise<void> {
    const showLinks = args.includes('--links');
    const stateManager = this.explorBot.getExplorer().getStateManager();
    const history = stateManager.getStateHistory();

    if (history.length === 0) {
      tag('multiline').log('No navigation history yet.');
      return;
    }

    const visited: VisitedPage[] = [];
    const seenUrls = new Set<string>();

    const addState = (state: { url?: string; h1?: string; title?: string; links?: Link[] } | null) => {
      if (!state) return;
      const url = state.url || '/';
      if (seenUrls.has(url)) return;
      seenUrls.add(url);
      const title = state.h1 || state.title || 'Untitled';
      visited.push({ title, url, links: state.links || [] });
    };

    for (const transition of history) {
      addState(transition.fromState);
      addState(transition.toState);
    }

    if (visited.length === 0) {
      tag('multiline').log('No unique paths visited.');
      return;
    }

    const lines: string[] = [];
    lines.push(`Navigation Path (${visited.length} unique pages):\n`);

    for (let i = 0; i < visited.length; i++) {
      const { title, url, links } = visited[i];
      lines.push(title);
      lines.push(url);

      if (i < visited.length - 1) {
        if (showLinks && links.length > 0) {
          lines.push('   │');
          for (const link of links.slice(0, 10)) {
            lines.push(`   │ → ${link.title} ${link.url}`);
          }
          if (links.length > 10) {
            lines.push(`   │   ... and ${links.length - 10} more links`);
          }
          lines.push('   │');
          lines.push('   ↓');
        } else {
          lines.push('   ↓');
        }
      } else if (showLinks && links.length > 0) {
        lines.push('   │');
        for (const link of links.slice(0, 10)) {
          lines.push(`   │ → ${link.title} ${link.url}`);
        }
        if (links.length > 10) {
          lines.push(`   │   ... and ${links.length - 10} more links`);
        }
      }
    }

    tag('multiline').log(lines.join('\n'));
  }
}
