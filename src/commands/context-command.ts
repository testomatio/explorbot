import { ActionResult } from '../action-result.js';
import { Researcher } from '../ai/researcher.js';
import { outputPath } from '../config.js';
import { type ContextData, type ContextMode, formatContextSummary } from '../utils/context-formatter.js';
import { tag } from '../utils/logger.js';
import { extractValidContainers } from '../utils/research-parser.js';
import { BaseCommand, type Suggestion } from './base-command.js';

export class ContextCommand extends BaseCommand {
  name = 'context';
  description = 'Show page context summary (URL, headings, experience, knowledge, ARIA, HTML, research)';
  suggestions: Suggestion[] = [
    { command: 'context:aria', hint: 'show page ARIA snapshot' },
    { command: 'context:html', hint: 'show page HTML' },
    { command: 'context:knowledge', hint: 'show relevant knowledge' },
    { command: 'context:experience', hint: 'show relevant experience' },
    { command: 'context:data', hint: 'show captured page data' },
  ];
  options = [
    { flags: '--visual', description: 'Include annotated screenshot' },
    { flags: '--screenshot', description: 'Include annotated screenshot' },
    { flags: '--full', description: 'Show full context with HTML' },
    { flags: '--attached', description: 'Show attached context mode' },
  ];

  async execute(args: string): Promise<void> {
    const explorer = this.explorBot.getExplorer();
    const state = explorer.getStateManager().getCurrentState();

    if (!state) {
      throw new Error('No active page to show context for');
    }

    const { opts } = this.parseArgs(args);
    const isVisual = !!(opts.visual || opts.screenshot);

    await explorer.annotateElements();

    if (isVisual) {
      const cachedResearch = Researcher.getCachedResearch(state);
      const containers = cachedResearch ? extractValidContainers(cachedResearch) : [];
      await explorer.visuallyAnnotateElements({ containers });
    }

    const actionResult = await explorer.createAction().capturePageState({ includeScreenshot: isVisual });
    const experienceTracker = explorer.getStateManager().getExperienceTracker();
    const knowledgeTracker = this.explorBot.getKnowledgeTracker();

    let mode: ContextMode = 'compact';
    if (opts.full) {
      mode = 'full';
    } else if (opts.attached) {
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

    if (isVisual && actionResult.screenshotFile) {
      const fullPath = outputPath('states', actionResult.screenshotFile);
      tag('info').log(`Screenshot saved: file://${fullPath}`);
    }
  }
}
