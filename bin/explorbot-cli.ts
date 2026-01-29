#!/usr/bin/env bun
import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { render } from 'ink';
import React from 'react';
import { App } from '../src/components/App.js';
import { ConfigParser } from '../src/config.js';
import { ExplorBot, type ExplorBotOptions } from '../src/explorbot.js';
import { log, setPreserveConsoleLogs } from '../src/utils/logger.js';

const program = new Command();

program.name('explorbot').description('AI-powered web exploration tool');

program
  .command('explore')
  .description('Start web exploration')
  .option('-f, --from <url>', 'Start exploration from a specific URL')
  .option('-v, --verbose', 'Enable verbose logging')
  .option('--debug', 'Enable debug logging (same as --verbose)')
  .option('-c, --config <path>', 'Path to configuration file')
  .option('-p, --path <path>', 'Working directory path')
  .option('-s, --show', 'Show browser window')
  .option('--headless', 'Run browser in headless mode (opposite of --show)')
  .option('--freeride', 'Continuously explore and navigate to new pages')
  .option('--incognito', 'Run without recording experiences')
  .action(async (options) => {
    const initialShowInput = !options.from;
    setPreserveConsoleLogs(false);

    const mainOptions: ExplorBotOptions = {
      from: options.from,
      verbose: options.verbose || options.debug,
      config: options.config,
      path: options.path,
      show: options.show,
      headless: options.headless,
      incognito: options.incognito,
    };

    const explorBot = new ExplorBot(mainOptions);
    await explorBot.start();

    if (options.freeride) {
      await explorBot.freeride();
      return;
    }

    if (!process.stdin.isTTY) {
      console.error('Warning: Input not available. Running in non-interactive mode.');
    }

    process.env.INK_RUNNING = 'true';

    render(React.createElement(App, { explorBot, initialShowInput }), {
      exitOnCtrlC: false,
      patchConsole: true,
    });

    const cleanup = async () => {
      await explorBot.stop();
      process.exit(0);
    };

    process.on('SIGINT', async () => {
      console.log('\nReceived SIGINT, cleaning up...');
      await cleanup();
    });

    process.on('SIGTERM', async () => {
      console.log('\nReceived SIGTERM, cleaning up...');
      await cleanup();
    });
  });

program
  .command('init')
  .description('Initialize a new project with configuration')
  .option('-c, --config-path <path>', 'Path for the config file', './explorbot.config.js')
  .option('-f, --force', 'Overwrite existing config file')
  .option('-p, --path <path>', 'Working directory for initialization')
  .action(async (options) => {
    const configPath = options.configPath || './explorbot.config.js';
    const force = options.force || false;
    const customPath = options.path;
    const originalCwd = process.cwd();

    if (customPath) {
      const resolvedPath = path.resolve(customPath);
      if (!fs.existsSync(resolvedPath)) {
        fs.mkdirSync(resolvedPath, { recursive: true });
        log(`Created directory: ${resolvedPath}`);
      }
      process.chdir(resolvedPath);
      log(`Working in directory: ${resolvedPath}`);
    }

    const defaultConfig = `import { openai } from 'ai';

const config = {
  playwright: {
    browser: 'chromium',
    url: 'http://localhost:3000',
    windowSize: '1200x900',
  },

  ai: {
    provider: openai,
    model: 'gpt-4o',
    apiKey: process.env.OPENAI_API_KEY || '',
  },
};

export default config;
`;

    try {
      let resolvedPath = path.resolve(configPath);
      if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory()) {
        resolvedPath = path.join(resolvedPath, 'explorbot.config.js');
      } else if (!path.extname(resolvedPath)) {
        resolvedPath = path.join(resolvedPath, 'explorbot.config.js');
      }

      const dir = path.dirname(resolvedPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        log(`Created directory: ${dir}`);
      }

      if (fs.existsSync(resolvedPath) && !force) {
        log(`Config file already exists: ${resolvedPath}`);
        log('Use --force to overwrite existing file');
        process.exit(1);
      }

      fs.writeFileSync(resolvedPath, defaultConfig, 'utf8');
      log(`Created config file: ${resolvedPath}`);
      log('');
      log('Next steps:');
      log('1. Set your API key in the config file or as environment variable');
      log('2. Customize the configuration as needed');
      log('3. Run: explorbot explore');

      if (!fs.existsSync('./output')) {
        fs.mkdirSync('./output', { recursive: true });
        log('Created directory: ./output');
      }
    } catch (error) {
      log('Failed to create config file:', error);
      process.exit(1);
    } finally {
      if (process.cwd() !== originalCwd) {
        process.chdir(originalCwd);
      }
    }
  });

program
  .command('clean')
  .description('Clean generated files and folders')
  .option('-t, --type <type>', 'Type of cleaning: artifacts, experience, or all', 'artifacts')
  .option('-p, --path <path>', 'Custom path to clean')
  .action(async (options) => {
    const type = options.type || 'artifacts';
    const customPath = options.path;
    const originalCwd = process.cwd();
    const basePath = customPath ? path.resolve(originalCwd, customPath) : process.cwd();

    async function cleanDirectoryContents(dirPath: string): Promise<void> {
      const items = fs.readdirSync(dirPath);
      for (const item of items) {
        const itemPath = path.join(dirPath, item);
        const stat = fs.statSync(itemPath);
        if (stat.isDirectory()) {
          await cleanDirectoryContents(itemPath);
          console.log(`Removed directory: ${item}`);
        } else {
          fs.unlinkSync(itemPath);
          console.log(`Removed file: ${item}`);
        }
      }
    }

    async function cleanPath(targetPath: string, displayName: string): Promise<void> {
      const resolvedPath = path.resolve(targetPath);
      if (!fs.existsSync(resolvedPath)) {
        console.log(`${displayName} path does not exist: ${resolvedPath}`);
        return;
      }
      const stat = fs.statSync(resolvedPath);
      try {
        if (stat.isDirectory()) {
          console.log(`Cleaning ${displayName} folder: ${resolvedPath}`);
          await cleanDirectoryContents(resolvedPath);
          console.log(`${displayName} folder cleaned successfully`);
        } else {
          console.log(`Removing ${displayName} file: ${resolvedPath}`);
          fs.unlinkSync(resolvedPath);
          console.log(`${displayName} file removed successfully`);
        }
      } catch (error) {
        console.error(`Failed to clean ${displayName}:`, error);
      }
    }

    try {
      if (customPath) {
        const resolvedPath = path.resolve(originalCwd, customPath);
        console.log(`Working in directory: ${resolvedPath}`);
        process.chdir(resolvedPath);
        try {
          await ConfigParser.getInstance().loadConfig({ path: '.' });
          console.log(`Configuration loaded from: ${resolvedPath}`);
        } catch {
          console.log(`No configuration found in ${resolvedPath}, using default paths`);
        }
      }

      if (type === 'artifacts' || type === 'all') {
        await cleanPath(path.join(basePath, 'output'), 'output');
      }
      if (type === 'experience' || type === 'all') {
        await cleanPath(path.join(basePath, 'experience'), 'experience');
      }
      console.log('Cleanup completed successfully!');
    } catch (error) {
      console.error('Failed to clean:', error);
      process.exit(1);
    } finally {
      if (process.cwd() !== originalCwd) {
        process.chdir(originalCwd);
      }
    }
  });

program
  .command('know [url] [description]')
  .alias('knows')
  .description('Add knowledge for URLs')
  .option('-p, --path <path>', 'Working directory path')
  .action(async (url, description, options) => {
    try {
      await ConfigParser.getInstance().loadConfig({ path: options.path || process.cwd() });

      if (url && description) {
        const { KnowledgeTracker } = await import('../src/knowledge-tracker.js');
        const tracker = new KnowledgeTracker();
        const result = tracker.addKnowledge(url, description);
        const action = result.isNewFile ? 'Created' : 'Updated';
        console.log(`Knowledge ${action} in: ${result.filename}`);
        return;
      }

      const AddKnowledge = (await import('../src/components/AddKnowledge.js')).default;
      render(React.createElement(AddKnowledge, { initialUrl: url || '' }), {
        exitOnCtrlC: false,
        patchConsole: false,
      });
    } catch (error) {
      console.error('Failed:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

program.parse();
