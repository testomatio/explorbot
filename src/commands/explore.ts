import React from 'react';
import { render } from 'ink';
import { App } from '../components/App.js';
import { ExplorBot, type ExplorBotOptions } from '../explorbot.js';

export interface ExploreOptions {
  from?: string;
  verbose?: boolean;
  debug?: boolean;
  config?: string;
  path?: string;
}

export async function exploreCommand(options: ExploreOptions) {
  const initialShowInput = !options.from;

  const mainOptions: ExplorBotOptions = {
    from: options.from,
    verbose: options.verbose || options.debug,
    config: options.config,
    path: options.path,
  };

  const explorBot = new ExplorBot(mainOptions);
  await explorBot.loadConfig();

  if (!process.stdin.isTTY) {
    console.error(
      'Warning: Input not available. Running in non-interactive mode.'
    );
  }

  render(
    React.createElement(App, {
      explorBot,
      initialShowInput,
    })
  );

  process.on('SIGINT', async () => {
    console.log('\n🛑 Received SIGINT, cleaning up...');
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n🛑 Received SIGTERM, cleaning up...');
    process.exit(0);
  });
}
