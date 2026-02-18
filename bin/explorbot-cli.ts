#!/usr/bin/env bun
import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { render } from 'ink';
import React from 'react';
import { App } from '../src/components/App.js';
import { StatusPane } from '../src/components/StatusPane.js';
import { ConfigParser } from '../src/config.js';
import { ExplorBot, type ExplorBotOptions } from '../src/explorbot.js';
import { Stats } from '../src/stats.js';
import { log, setPreserveConsoleLogs } from '../src/utils/logger.js';

const program = new Command();

program.name('explorbot').description('AI-powered web exploration tool');

interface CLIOptions {
  verbose?: boolean;
  debug?: boolean;
  config?: string;
  path?: string;
  show?: boolean;
  headless?: boolean;
  incognito?: boolean;
  session?: string | boolean;
}

function buildExplorBotOptions(from: string | undefined, options: CLIOptions): ExplorBotOptions {
  return {
    from,
    verbose: options.verbose || options.debug,
    config: options.config,
    path: options.path,
    show: options.show,
    headless: options.headless,
    incognito: options.incognito,
    session: options.session === true ? 'output/session.json' : options.session,
  } as ExplorBotOptions;
}

function addCommonOptions(cmd: Command): Command {
  return cmd
    .option('-v, --verbose', 'Enable verbose logging')
    .option('--debug', 'Enable debug logging (same as --verbose)')
    .option('-c, --config <path>', 'Path to configuration file')
    .option('-p, --path <path>', 'Working directory path')
    .option('-s, --show', 'Show browser window')
    .option('--headless', 'Run browser in headless mode')
    .option('--incognito', 'Run without recording experiences')
    .option('--session [file]', 'Save/restore browser session from file', 'output/session.json');
}

async function startTUI(explorBot: ExplorBot): Promise<void> {
  if (!process.stdin.isTTY) {
    console.error('Warning: Input not available. Running in non-interactive mode.');
  }

  process.env.INK_RUNNING = 'true';

  render(React.createElement(App, { explorBot, initialShowInput: false }), {
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
}

async function showStatsAndExit(code: number): Promise<never> {
  if (Stats.hasActivity()) {
    await new Promise<void>((resolve) => {
      const { unmount } = render(
        React.createElement(StatusPane, {
          onComplete: () => {
            unmount();
            resolve();
          },
        }),
        {
          exitOnCtrlC: false,
          patchConsole: false,
        }
      );
    });
  }
  process.exit(code);
}

addCommonOptions(program.command('start [path]').alias('sail').description('Start web exploration')).action(async (startPath, options) => {
  setPreserveConsoleLogs(false);
  const explorBot = new ExplorBot(buildExplorBotOptions(startPath, options));
  await explorBot.start();
  await startTUI(explorBot);
});

addCommonOptions(program.command('explore <path>').description('Start web exploration (legacy command)')).action(async (explorePath, options) => {
  try {
    const explorBot = new ExplorBot(buildExplorBotOptions(explorePath, options));
    await explorBot.start();
    await explorBot.visit(explorePath);
    await explorBot.explore();
    await explorBot.stop();
    await showStatsAndExit(0);
  } catch (error) {
    console.error('Failed:', error instanceof Error ? error.message : 'Unknown error');
    await showStatsAndExit(1);
  }
});

addCommonOptions(program.command('plan <path> [feature]').description('Generate test plan for a page and exit'))
  .option('--fresh', 'Start planning from scratch, ignoring existing plan')
  .action(async (planPath, feature, options) => {
    try {
      const explorBot = new ExplorBot(buildExplorBotOptions(planPath, options));
      await explorBot.start();

      await explorBot.visit(planPath);
      await explorBot.plan(feature || undefined, { fresh: options.fresh });

      const plan = explorBot.getCurrentPlan();
      if (!plan?.tests.length) {
        console.error('No test scenarios generated.');
        await explorBot.stop();
        await showStatsAndExit(1);
      }

      console.log(`Plan ready with ${plan.tests.length} tests:`);
      for (const test of plan.tests) {
        console.log(`  - ${test.scenario}`);
      }

      await explorBot.stop();
      await showStatsAndExit(0);
    } catch (error) {
      console.error('Failed:', error instanceof Error ? error.message : 'Unknown error');
      await showStatsAndExit(1);
    }
  });

addCommonOptions(program.command('freesail [startUrl]').description('Continuously explore and navigate to new pages autonomously')).action(async (startUrl, options) => {
  const explorBot = new ExplorBot(buildExplorBotOptions(startUrl || '/', options));
  await explorBot.start();
  await explorBot.freeride();
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
      log('3. Run: explorbot start');

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
  .option('--session [file]', 'Save/restore browser session from file', 'output/session.json')
  .option('--data', 'Include data extraction in research')
  .option('--deep', 'Enable deep analysis (expand hidden elements)')
  .option('--no-fix', 'Skip locator fix cycle (for debugging)')
  .action(async (url, options) => {
    try {
      const mainOptions: ExplorBotOptions = {
        path: options.path,
        config: options.config,
        show: options.show,
        headless: options.headless,
        session: options.session === true ? 'output/session.json' : options.session,
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
        deep: options.deep || false,
        fix: options.fix !== false,
      });

      await explorBot.stop();
      await showStatsAndExit(0);
    } catch (error) {
      console.error('Failed:', error instanceof Error ? error.message : 'Unknown error');
      await showStatsAndExit(1);
    }
  });

addCommonOptions(
  program.command('drill <url>').alias('bosun').description('Drill all components on a page to learn interactions').option('--knowledge <path>', 'Save learned interactions to knowledge file at this URL path').option('--max <count>', 'Maximum number of components to drill', '20')
).action(async (url, options) => {
  try {
    const explorBot = new ExplorBot(buildExplorBotOptions(url, options));
    await explorBot.start();

    await explorBot.visit(url);

    const plan = await explorBot.agentBosun().drill({
      knowledgePath: options.knowledge,
      maxComponents: Number.parseInt(options.max, 10),
      interactive: false,
    });

    console.log(`\nDrill completed: ${plan.tests.length} components`);
    console.log(`Successful: ${plan.tests.filter((t) => t.isSuccessful).length}`);
    console.log(`Failed: ${plan.tests.filter((t) => t.hasFailed).length}`);

    await explorBot.stop();
    await showStatsAndExit(0);
  } catch (error) {
    console.error('Failed:', error instanceof Error ? error.message : 'Unknown error');
    await showStatsAndExit(1);
  }
});

program
  .command('context <url>')
  .description('Print page context (URL, headings, knowledge, experience, interactive elements)')
  .option('-p, --path <path>', 'Working directory path')
  .option('-c, --config <path>', 'Path to configuration file')
  .option('--session [file]', 'Save/restore browser session from file', 'output/session.json')
  .option('--full', 'Include HTML and all data')
  .option('--compact', 'Compact view with summaries')
  .option('--attached', 'Only auto-attached sections (default)')
  .action(async (url, options) => {
    try {
      const mainOptions: ExplorBotOptions = {
        path: options.path,
        config: options.config,
        headless: true,
        session: options.session === true ? 'output/session.json' : options.session,
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
      await showStatsAndExit(0);
    } catch (error) {
      console.error('Failed:', error instanceof Error ? error.message : 'Unknown error');
      await showStatsAndExit(1);
    }
  });

program.parse();
