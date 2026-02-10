import { render } from 'ink';
import React from 'react';
import { StatusPane } from '../components/StatusPane.js';
import { BaseCommand } from './base-command.js';

export class StatusCommand extends BaseCommand {
  name = 'status';
  description = 'Show session statistics and token usage';

  async execute(_args: string): Promise<void> {
    return new Promise((resolve) => {
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
}
