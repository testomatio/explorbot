#!/usr/bin/env bun
import { Command } from 'commander';
import { exploreCommand } from '../src/commands/explore.js';
import { cleanCommand } from '../src/commands/clean.js';
import { initCommand } from '../src/commands/init.js';

const program = new Command();

program.name('maclay').description('AI-powered web exploration tool');

program
  .command('explore')
  .description('Start web exploration')
  .option('-f, --from <url>', 'Start exploration from a specific URL')
  .option('-v, --verbose', 'Enable verbose logging')
  .option('--debug', 'Enable debug logging (same as --verbose)')
  .option('-c, --config <path>', 'Path to configuration file')
  .option('-p, --path <path>', 'Working directory path')
  .helpOption('-h, --help', 'Show this help message')
  .action(exploreCommand);

program
  .command('clean')
  .description('Clean generated files and folders')
  .option(
    '-t, --type <type>',
    'Type of cleaning: artifacts, experience, or all',
    'artifacts'
  )
  .option('-p, --path <path>', 'Custom path to clean')
  .action(cleanCommand);

program
  .command('init')
  .description('Initialize a new project with configuration')
  .option(
    '-c, --config-path <path>',
    'Path for the config file',
    './explorbot.config.js'
  )
  .option('-f, --force', 'Overwrite existing config file', false)
  .option('-p, --path <path>', 'Working directory for initialization')
  .action(initCommand);

program.parse();
