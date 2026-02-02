import { render } from 'ink';
import React from 'react';
import { tag } from '../utils/logger.js';
import { BaseCommand } from './base-command.js';

export class KnowCommand extends BaseCommand {
  name = 'knows:add';
  aliases = ['add-knowledge'];
  description = 'Store knowledge for current page';

  async execute(args: string): Promise<void> {
    const note = args.trim();

    if (!note) {
      const AddKnowledge = (await import('../components/AddKnowledge.js')).default;
      const state = this.explorBot.getExplorer().getStateManager().getCurrentState();
      const initialUrl = state?.url || '';

      const { unmount } = render(
        React.createElement(AddKnowledge, {
          initialUrl,
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
    const state = explorer.getStateManager().getCurrentState();

    if (!state) {
      throw new Error('No active page to attach knowledge');
    }

    const targetUrl = state.url || state.fullUrl || '/';
    explorer.getKnowledgeTracker().addKnowledge(targetUrl, note);
    tag('success').log('Knowledge saved for current page');
  }
}
