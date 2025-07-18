#!/usr/bin/env node

import path from 'node:path';
import { render } from 'ink';
import React from 'react';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { InitCommand } from './commands/InitCommand.js';
import App from './components/App.js';

const argv = yargs(hideBin(process.argv))
  .command(
    'init',
    'Initialize explorbot.config.js in current directory',
    {
      path: {
        alias: 'p',
        type: 'string',
        description:
          'Path to create config file (default: ./explorbot.config.js)',
        default: './explorbot.config.js',
      },
      force: {
        alias: 'f',
        type: 'boolean',
        description: 'Overwrite existing config file',
        default: false,
      },
    },
    (argv) => {
      const initCommand = new InitCommand();
      initCommand.run(argv.path, argv.force);
    }
  )
  .option('verbose', {
    alias: 'v',
    type: 'boolean',
    description: 'Run with verbose logging',
  })
  .option('config', {
    alias: 'c',
    type: 'string',
    description: 'Path to config file',
  })
  .option('path', {
    alias: 'p',
    type: 'string',
    description:
      'Directory path where config file is located (default: current directory)',
  })
  .help()
  .alias('help', 'h')
  .parseSync();

if (argv._.length === 0) {
  let configPath = argv.config;

  if (argv.path) {
    const dirPath = path.resolve(argv.path);
    configPath = path.join(dirPath, 'explorbot.config.js');
  }

  render(<App verbose={argv.verbose} config={configPath} />);
}
