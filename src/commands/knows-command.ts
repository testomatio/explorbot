import { log, tag } from '../utils/logger.js';
import { BaseCommand } from './base-command.js';

export function formatKnowledgeList(knowledge: Array<{ url: string; firstLine: string }>, limit = 0): string {
  const lines: string[] = [];
  const display = limit > 0 ? knowledge.slice(0, limit) : knowledge;

  for (const entry of display) {
    const preview = entry.firstLine ? ` - ${entry.firstLine}` : '';
    lines.push(`* \`${entry.url}\` ${preview}`);
  }

  if (limit > 0 && knowledge.length > limit) {
    lines.push(`... and ${knowledge.length - limit} more`);
  }

  return lines.join('\n');
}

export class KnowsCommand extends BaseCommand {
  name = 'knows';
  description = 'List all knowledge URLs or show matching knowledge for a URL';

  async execute(args: string, limit = 0): Promise<void> {
    const url = args.trim();
    const tracker = this.explorBot.getKnowledgeTracker();

    if (!url) {
      const allKnowledge = tracker.listAllKnowledge();

      if (allKnowledge.length === 0) {
        log('No knowledge files found. Use /knows:add to add knowledge about your application.');
        return;
      }

      let output = `Found ${allKnowledge.length} knowledge entries:\n\n${formatKnowledgeList(allKnowledge, limit)}`;

      const currentState = this.explorBot.getCurrentState();
      if (currentState?.url) {
        const currentMatching = tracker.getMatchingKnowledge(currentState.url);
        if (currentMatching.length > 0) {
          output += `\n\n**Knowledge for current page** (${currentState.url}):`;
          for (const k of currentMatching) {
            output += `\n\n\`${k.url}\`:\n${k.content.trim()}`;
          }
        }
      }

      output += '\n\nUse /knows:add to add knowledge';
      tag('multiline').log(output);
      return;
    }

    const matching = tracker.getMatchingKnowledge(url);

    if (matching.length === 0) {
      log(`No knowledge found for: ${url}`);
      return;
    }

    const knowledgeList = matching.map((k) => {
      const firstLine = k.content.trim().split('\n')[0] || '';
      return { url: k.url, firstLine };
    });

    tag('multiline').log(`Found ${matching.length} matching knowledge entries for: ${url}\n\n${formatKnowledgeList(knowledgeList)}`);
  }
}
