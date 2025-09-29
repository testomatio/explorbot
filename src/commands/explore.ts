import { render } from 'ink';
import React from 'react';
import { App } from '../components/App.js';
import { ExplorBot, type ExplorBotOptions } from '../explorbot.js';
import { setPreserveConsoleLogs } from '../utils/logger.js';

export interface ExploreOptions {
  from?: string;
  verbose?: boolean;
  debug?: boolean;
  config?: string;
  path?: string;
  show?: boolean;
  headless?: boolean;
}

export async function exploreCommand(options: ExploreOptions) {
  const initialShowInput = !options.from;

  // Enable console log persistence for after exit
  setPreserveConsoleLogs(true);

  const mainOptions: ExplorBotOptions = {
    from: options.from,
    verbose: options.verbose || options.debug,
    config: options.config,
    path: options.path,
    show: options.show,
    headless: options.headless,
  };

  const explorBot = new ExplorBot(mainOptions);
  await explorBot.loadConfig();

  if (!process.stdin.isTTY) {
    console.error('Warning: Input not available. Running in non-interactive mode.');
  }

  render(
    React.createElement(App, {
      explorBot,
      initialShowInput,
    }),
    {
      exitOnCtrlC: false,
      patchConsole: false, // Don't redirect console.log
    }
  );

  const cleanup = async () => {
    // Just exit normally, let the terminal handle cleanup
    process.exit(0);
  };

  process.on('SIGINT', async () => {
    console.log('\n🛑 Received SIGINT, cleaning up...');
    await cleanup();
  });

  process.on('SIGTERM', async () => {
    console.log('\n🛑 Received SIGTERM, cleaning up...');
    await cleanup();
  });
}
