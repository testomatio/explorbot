#!/usr/bin/env node
import { exploreCommand } from './commands/explore.js';
import { cleanCommand } from './commands/clean.js';
import { initCommand } from './commands/init.js';
import { addKnowledgeCommand } from './commands/add-knowledge.js';
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

program
  .command('clean')
  .description('Clean up artifacts or experience folders')
  .option(
    '-t, --type <type>',
    'Type of cleanup (artifacts|experience|all)',
    'artifacts'
  )
  .option('-p, --path <path>', 'Custom path to clean')
  .action(async (options, command) => {
    const globalOptions = command.parent.opts();
    const allOptions = { ...globalOptions, ...options };
    await cleanCommand(allOptions);
  });

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
  .action(async (options, command) => {
    const globalOptions = command.parent.opts();
    const allOptions = { ...globalOptions, ...options };
    await initCommand(allOptions);
  });

program
  .command('add-knowledge')
  .alias('knows')
  .description('Add knowledge for specific URLs')
  .option('-p, --path <path>', 'Knowledge directory path')
  .action(async (options) => {
    await addKnowledgeCommand(options);
  });

program.parse();

const options = program.opts();
const command = program.args[0];

if (
  command === 'clean' ||
  command === 'init' ||
  command === 'add-knowledge' ||
  command === 'knows'
) {
  // These commands are handled by their respective actions
} else {
  // Default to explore command
  exploreCommand(options);
}
