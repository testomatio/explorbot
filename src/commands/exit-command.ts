import { render } from 'ink';
import React from 'react';
import { StatusPane } from '../components/StatusPane.js';
import { Stats } from '../stats.js';
import { BaseCommand } from './base-command.js';

export class ExitCommand extends BaseCommand {
  name = 'exit';
  description = 'Exit the application';
  aliases = ['quit'];

  async execute(_args: string): Promise<void> {
    await this.explorBot.getExplorer().stop();

    if (Stats.hasActivity()) {
      await new Promise<void>((resolve) => {
        const { unmount } = render(
          React.createElement(StatusPane, {
            onComplete: () => {
              unmount();
              resolve();
            },
          }),
          { exitOnCtrlC: false, patchConsole: false }
        );
      });
    }

    console.log('\nGoodbye!');
    process.exit(0);
  }
}
