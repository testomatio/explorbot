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
    let initialShowInput = !options.from;
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

    if (!process.stdin.isTTY) {
      console.error('Warning: Input not available. Running in non-interactive mode.');
    }

    process.env.INK_RUNNING = 'true';

    try {
      await explorBot.visitInitialState();
      initialShowInput = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('\nFailed to start:', message);
      await explorBot.stop();
      process.exit(1);
    }

    if (options.freeride) {
      await explorBot.freeride();
      return;
    }

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

    const defaultConfig = `import { <your provider here> } from 'ai';

const config = {
  playwright: {
    browser: 'chromium',
    url: 'http://localhost:3000',
    windowSize: '1200x900',
  },

  ai: {
    provider: <your provider here>,
    model: '<your model here>',
    apiKey: '<your api key here>',
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
  .command('knows:add [url] [description]')
  .alias('add-knowledge')
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

program
  .command('knows [url]')
  .description('List all knowledge URLs or show matching knowledge for a URL')
  .option('-p, --path <path>', 'Working directory path')
  .action(async (url, options) => {
    try {
      await ConfigParser.getInstance().loadConfig({ path: options.path || process.cwd() });
      const { KnowsCommand } = await import('../src/commands/knows-command.js');
      const explorBot = new ExplorBot({ path: options.path });
      const command = new KnowsCommand(explorBot);
      await command.execute(url || '');
    } catch (error) {
      console.error('Failed:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

program
  .command('research <url>')
  .description('Research a page and print UI analysis')
  .option('-p, --path <path>', 'Working directory path')
  .option('-c, --config <path>', 'Path to configuration file')
  .option('-s, --show', 'Show browser window')
  .option('--headless', 'Run browser in headless mode')
  .option('--data', 'Include data extraction in research')
  .action(async (url, options) => {
    try {
      const mainOptions: ExplorBotOptions = {
        path: options.path,
        config: options.config,
        show: options.show,
        headless: options.headless,
      };

      const explorBot = new ExplorBot(mainOptions);
      await explorBot.start();

      await explorBot.visit(url);

      const state = explorBot.getExplorer().getStateManager().getCurrentState();
      if (!state) {
        throw new Error('No active page to research');
      }

      await explorBot.agentResearcher().research(state, {
        screenshot: true,
        force: true,
        data: options.data || false,
      });

      await explorBot.stop();
      process.exit(0);
    } catch (error) {
      console.error('Failed:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

program
  .command('context <url>')
  .description('Print page context (URL, headings, knowledge, experience, interactive elements)')
  .option('-p, --path <path>', 'Working directory path')
  .option('-c, --config <path>', 'Path to configuration file')
  .option('--full', 'Include HTML and all data')
  .option('--compact', 'Compact view with summaries')
  .option('--attached', 'Only auto-attached sections (default)')
  .action(async (url, options) => {
    try {
      const mainOptions: ExplorBotOptions = {
        path: options.path,
        config: options.config,
        headless: true,
      };

      const explorBot = new ExplorBot(mainOptions);
      await explorBot.start();

      await explorBot.agentNavigator().visit(url);

      const { ActionResult } = await import('../src/action-result.js');
      const { Researcher } = await import('../src/ai/researcher.js');
      const { formatContextSummary } = await import('../src/utils/context-formatter.js');

      const state = explorBot.getExplorer().getStateManager().getCurrentState();
      if (!state) {
        throw new Error('No active page');
      }

      let mode: 'attached' | 'compact' | 'full' = 'attached';
      if (options.full) {
        mode = 'full';
      } else if (options.compact) {
        mode = 'compact';
      }

      const actionResult = ActionResult.fromState(state);
      const experienceTracker = explorBot.getExplorer().getStateManager().getExperienceTracker();
      const knowledgeTracker = explorBot.getKnowledgeTracker();

      const contextData = {
        url: actionResult.url,
        title: actionResult.title,
        headings: {
          h1: actionResult.h1,
          h2: actionResult.h2,
          h3: actionResult.h3,
          h4: actionResult.h4,
        },
        experience: experienceTracker.getRelevantExperience(actionResult),
        knowledge: knowledgeTracker.getRelevantKnowledge(actionResult),
        ariaSnapshot: actionResult.ariaSnapshot,
        combinedHtml: mode === 'full' ? await actionResult.combinedHtml() : undefined,
        research: Researcher.getCachedResearch(state),
      };

      const output = formatContextSummary(contextData, mode);
      console.log(output);

      await explorBot.stop();
      process.exit(0);
    } catch (error) {
      console.error('Failed:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

program.parse();
