import { render } from 'ink';
import React from 'react';
import { tag } from '../utils/logger.js';
import { BaseCommand, type Suggestion } from './base-command.js';

export class LearnCommand extends BaseCommand {
  name = 'learn';
  description = 'Store knowledge for current page';
  suggestions: Suggestion[] = [{ command: 'knows', hint: 'view all knowledge' }];

  async execute(args: string): Promise<void> {
    const note = args.trim();

    if (!note) {
      const AddKnowledge = (await import('../components/AddKnowledge.js')).default;
      const explorer = this.explorBot.getExplorer();
      const state = this.explorBot.stateManager().getCurrentState();
      const initialUrl = state?.url || '';

      const { unmount } = render(
        React.createElement(AddKnowledge, {
          initialUrl,
          knowledgeTracker: this.explorBot.knowledgeTracker(),
          onComplete: () => unmount(),
          onCancel: () => unmount(),
        }),
        {
          exitOnCtrlC: false,
          patchConsole: false,
        }
      );
      return;
    }

    const explorer = this.explorBot.getExplorer();
    const state = this.explorBot.stateManager().getCurrentState();

    if (!state) {
      throw new Error('No active page to attach knowledge');
    }

    const targetUrl = state.url || state.fullUrl || '/';
    this.explorBot.knowledgeTracker().addKnowledge(targetUrl, note);
    tag('success').log('Knowledge saved for current page');
  }
}
