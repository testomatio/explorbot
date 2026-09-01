import { KnowledgeTracker } from '../../knowledge-tracker.js';
import { BaseOption } from './base-option.js';

export class KnowledgeOption extends BaseOption {
  flags = '--knowledge <text>';
  description = 'Knowledge for this run only, not saved to disk. Markdown text; add url: or endpoint: frontmatter to scope it, otherwise it applies everywhere. Repeatable';
  collect = (value: string, previous: string[] = []) => [...previous, value];

  protected apply(options: Record<string, any>): void {
    for (const text of options.knowledge || []) {
      KnowledgeTracker.appendSessionKnowledge(text);
    }
  }
}
