import { ActionResult } from '../action-result.js';
import { Researcher } from '../ai/researcher.js';
import { type ContextData, type ContextMode, formatContextSummary } from '../utils/context-formatter.js';
import { tag } from '../utils/logger.js';
import { BaseCommand } from './base-command.js';

export class ContextCommand extends BaseCommand {
  name = 'context';
  description = 'Show page context summary (URL, headings, experience, knowledge, ARIA, HTML, research)';
  suggestions = ['context:aria', 'context:html', 'context:knowledge', 'context:experience', 'context:data'];

  async execute(args: string): Promise<void> {
    const explorer = this.explorBot.getExplorer();
    const state = explorer.getStateManager().getCurrentState();

    if (!state) {
      throw new Error('No active page to show context for');
    }

    const actionResult = ActionResult.fromState(state);
    const experienceTracker = explorer.getStateManager().getExperienceTracker();
    const knowledgeTracker = this.explorBot.getKnowledgeTracker();

    let mode: ContextMode = 'compact';
    if (args.includes('--full')) {
      mode = 'full';
    } else if (args.includes('--attached')) {
      mode = 'attached';
    }

    const contextData: ContextData = {
      url: actionResult.url,
      title: actionResult.title,
      headings: {
        h1: actionResult.h1,
        h2: actionResult.h2,
        h3: actionResult.h3,
        h4: actionResult.h4,
      },
      experience: experienceTracker.getRelevantExperience(actionResult),
      knowledge: knowledgeTracker.getRelevantKnowledge(actionResult),
      ariaSnapshot: actionResult.ariaSnapshot,
      combinedHtml: mode === 'full' ? await actionResult.combinedHtml() : undefined,
      research: Researcher.getCachedResearch(state),
    };

    const output = formatContextSummary(contextData, mode);
    tag('multiline').log(output);
  }
}
