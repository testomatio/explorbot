#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { App } from './components/App.js';
import { ExplorBot, type ExplorBotOptions } from './explorbot.ts';

// Parse command line arguments
const args = process.argv.slice(2);
const options: ExplorBotOptions = {};

// Parse options
for (let i = 0; i < args.length; i++) {
  const arg = args[i];

  if (arg === '--from' && i + 1 < args.length) {
    options.from = args[++i];
  } else if (arg === '--verbose' || arg === '-v' || arg === '--debug') {
    options.verbose = true;
  } else if (arg === '--config' && i + 1 < args.length) {
    options.config = args[++i];
  } else if (arg === '--path' && i + 1 < args.length) {
    options.path = args[++i];
  } else if (arg === '--help' || arg === '-h') {
    console.log(`
ExplorBot - AI-powered web exploration tool

Usage: explorbot [options]

Options:
  --from <url>           Start exploration from a specific URL
  --verbose, -v          Enable verbose logging
  --debug                Enable debug logging (same as --verbose)
  --config <path>        Path to configuration file
  --path <path>          Working directory path
  --help, -h             Show this help message

Examples:
  explorbot --from /uri/of-page/to-test
  explorbot --verbose --config ./config.json
  explorbot --debug
`);
    process.exit(0);
  }
}

const initialShowInput = !options.from;

const mainOptions: ExplorBotOptions = {
  from: options.from,
  verbose: options.verbose,
  config: options.config,
  path: options.path,
};

const explorBot = new ExplorBot(mainOptions);
await explorBot.loadConfig();

render(
  <App
    explorBot={explorBot}
    initialShowInput={initialShowInput}
    exitOnEmptyInput={true}
  />
);

// Handle process termination to ensure cleanup
process.on('SIGINT', async () => {
  console.log('\n🛑 Received SIGINT, cleaning up...');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Received SIGTERM, cleaning up...');
  process.exit(0);
});
