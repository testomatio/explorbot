#!/usr/bin/env node
import { exploreCommand } from './commands/explore.js';
import { Command } from 'commander';

const program = new Command();

program
  .name('explorbot')
  .description('AI-powered web exploration tool')
  .option('-f, --from <url>', 'Start exploration from a specific URL')
  .option('-v, --verbose', 'Enable verbose logging')
  .option('--debug', 'Enable debug logging (same as --verbose)')
  .option('-c, --config <path>', 'Path to configuration file')
  .option('-p, --path <path>', 'Working directory path')
  .helpOption('-h, --help', 'Show this help message');

program.parse();

const options = program.opts();
exploreCommand(options);
