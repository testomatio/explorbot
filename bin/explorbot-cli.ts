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
import { parseMarkdownToTerminal } from '../src/utils/markdown-terminal.js';
import { Plan } from '../src/test-plan.js';
import { jsonToTable } from '../src/utils/markdown-parser.js';

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
    .option('--session [file]', 'Save/restore browser session from file');
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

addCommonOptions(program.command('explore <path>').description('Start web exploration (legacy command)').option('--max-tests <count>', 'Maximum number of tests to run')).action(async (explorePath, options) => {
  try {
    const explorBot = new ExplorBot(buildExplorBotOptions(explorePath, options));
    await explorBot.start();
    await explorBot.visit(explorePath);
    const { ExploreCommand } = await import('../src/commands/explore-command.js');
    const cmd = new ExploreCommand(explorBot);
    if (options.maxTests) cmd.maxTests = Number.parseInt(options.maxTests, 10);
    await cmd.execute('');
    await explorBot.stop();
    await showStatsAndExit(0);
  } catch (error) {
    console.error('Failed:', error instanceof Error ? error.message : 'Unknown error');
    await showStatsAndExit(1);
  }
});

addCommonOptions(program.command('plan <path> [feature]').description('Generate test plan for a page and exit'))
  .option('-a, --append', 'Add tests to existing plan file')
  .option('--style <style>', 'Planning style: normal, curious, psycho')
  .action(async (planPath, feature, options) => {
    try {
      const explorBot = new ExplorBot(buildExplorBotOptions(planPath, options));
      await explorBot.start();

      await explorBot.visit(planPath);

      if (options.append) {
        const planFilename = explorBot.generatePlanFilename();
        const existingPlanPath = path.join(explorBot.getPlansDir(), planFilename);
        if (fs.existsSync(existingPlanPath)) {
          explorBot.loadPlan(existingPlanPath);
        }
      }

      await explorBot.plan(feature || undefined, { fresh: !options.append, style: options.style });

      const plan = explorBot.getCurrentPlan();
      if (!plan?.tests.length) {
        console.error('No test scenarios generated.');
        await explorBot.stop();
        await showStatsAndExit(1);
      }

      const savedPath = explorBot.savePlan();
      const planFile = savedPath ? path.basename(savedPath) : 'plan.md';

      const cliFlags = [options.path ? `--path ${options.path}` : '', options.session ? '--session' : ''].filter(Boolean).join(' ');
      const cliSuffix = cliFlags ? ` ${cliFlags}` : '';

      const lines: string[] = [];
      lines.push('Run tests:');
      lines.push(`\`explorbot test ${planFile} 1${cliSuffix}\` → run first test`);
      lines.push(`\`explorbot test ${planFile} 1-3${cliSuffix}\` → run tests 1 to 3`);
      lines.push(`\`explorbot test ${planFile} *${cliSuffix}\` → run all tests`);

      log(parseMarkdownToTerminal(lines.join('\n')));

      await explorBot.stop();
      await showStatsAndExit(0);
    } catch (error) {
      console.error('Failed:', error instanceof Error ? error.message : 'Unknown error');
      await showStatsAndExit(1);
    }
  });

addCommonOptions(program.command('plan:load <planfile> [index]').description('Load a plan file and display its tests. Pass index to see test details.')).action(async (planfile: string, index: string | undefined) => {
  try {
    const resolvedPath = path.resolve(planfile);
    if (!fs.existsSync(resolvedPath)) {
      console.error(`Plan file not found: ${resolvedPath}`);
      process.exit(1);
    }

    const plan = Plan.fromMarkdown(resolvedPath);
    const planFile = path.basename(resolvedPath);

    if (index) {
      const idx = Number.parseInt(index, 10);
      if (Number.isNaN(idx) || idx < 1 || idx > plan.tests.length) {
        console.error(`Invalid index: ${index}. Must be 1-${plan.tests.length}`);
        process.exit(1);
      }
      const test = plan.tests[idx - 1];
      const lines: string[] = [];
      lines.push(`## #${idx} ${test.scenario}\n`);
      lines.push(`**Priority:** ${test.priority}`);
      const planUrl = plan.url || plan.tests[0]?.startUrl;
      if (planUrl) lines.push(`**Plan URL:** ${planUrl}`);
      if (test.startUrl && test.startUrl !== planUrl) lines.push(`**Test URL:** ${test.startUrl}`);
      if (test.plannedSteps.length) {
        lines.push('\n**Steps:**');
        for (const step of test.plannedSteps) lines.push(`- ${step}`);
      }
      if (test.expected.length) {
        lines.push('\n**Expected:**');
        for (const exp of test.expected) lines.push(`- ${exp}`);
      }
      lines.push('');
      lines.push(`Run: \`explorbot test ${planFile} ${idx}\``);
      console.log(parseMarkdownToTerminal(lines.join('\n')));
      return;
    }

    const planUrl = plan.url || plan.tests[0]?.startUrl;
    const lines: string[] = [`**${plan.title}** (${plan.tests.length} tests)\n`];
    if (planUrl) {
      lines.push(`URL: ${planUrl}\n`);
    }

    const rows = plan.tests.map((test, i) => ({
      '#': String(i + 1),
      Priority: test.priority,
      Title: test.scenario.replace(/\|/g, '-'),
      Steps: String(test.plannedSteps.length),
      Expected: String(test.expected.length),
    }));
    lines.push(jsonToTable(rows, ['#', 'Priority', 'Title', 'Steps', 'Expected']));

    lines.push('View test details:');
    lines.push(`\`explorbot plan:load ${planFile} <index>\`\n`);
    lines.push('Run tests:');
    lines.push(`\`explorbot test ${planFile} 1\` → run first test`);
    lines.push(`\`explorbot test ${planFile} 1-3\` → run tests 1 to 3`);
    lines.push(`\`explorbot test ${planFile} *\` → run all tests`);

    console.log(parseMarkdownToTerminal(lines.join('\n')));
  } catch (error) {
    console.error('Failed:', error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
});

addCommonOptions(program.command('test <planfile> [index]').description('Execute tests from a plan file. Index: 1, 1,3, 1-5, *, all').option('--grep <pattern>', 'Run tests matching pattern')).action(async (planfile, index, options) => {
  try {
    const explorBot = new ExplorBot(buildExplorBotOptions(undefined, options));
    await explorBot.start();

    const plan = explorBot.loadPlan(planfile);
    const pending = plan.getPendingTests();
    log(`Plan loaded: "${plan.title}" (${plan.tests.length} tests, ${pending.length} pending)`);

    const startUrl = plan.url || pending[0]?.startUrl;
    if (!startUrl) {
      throw new Error('No URL found in plan or tests. Cannot determine where to navigate.');
    }

    log(`Navigating to ${startUrl}`);
    await explorBot.visit(startUrl);

    let args = '';
    if (index) args = index;
    else if (options.grep) args = options.grep;

    const { TestCommand } = await import('../src/commands/test-command.js');
    const cmd = new TestCommand(explorBot);
    await cmd.execute(args);

    await explorBot.stop();
    await showStatsAndExit(0);
  } catch (error) {
    console.error('Failed:', error instanceof Error ? error.message : 'Unknown error');
    await showStatsAndExit(1);
  }
});

addCommonOptions(
  program
    .command('freesail [startUrl]')
    .description('Continuously explore and navigate to new pages autonomously')
    .option('--deep', 'Depth-first: prioritize newly discovered pages')
    .option('--shallow', 'Breadth-first: pick globally least-visited page')
    .option('--scope <prefix>', 'Restrict navigation to URL prefix')
    .option('--max-tests <count>', 'Maximum number of tests to run')
).action(async (startUrl, options) => {
  const explorBot = new ExplorBot(buildExplorBotOptions(startUrl || '/', options));
  await explorBot.start();
  const args = [options.deep && '--deep', options.shallow && '--shallow', options.scope && `--scope ${options.scope}`, options.maxTests && `--max-tests ${options.maxTests}`].filter(Boolean).join(' ');
  const { FreesailCommand } = await import('../src/commands/freesail-command.js');
  const cmd = new FreesailCommand(explorBot);
  await cmd.execute(args);
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

  reporter: {
    enabled: true,
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
  .command('clean [target]')
  .description('Clean files: states, research, plans, experiences, output (default: output + experiences)')
  .option('-p, --path <path>', 'Custom path to clean')
  .action(async (target, options) => {
    const customPath = options.path;
    const originalCwd = process.cwd();
    const basePath = customPath ? path.resolve(originalCwd, customPath) : process.cwd();

    const targets: Record<string, { description: string; dir: string }> = {
      states: { description: 'page states', dir: path.join(basePath, 'output', 'states') },
      research: { description: 'research cache', dir: path.join(basePath, 'output', 'research') },
      plans: { description: 'test plans', dir: path.join(basePath, 'output', 'plans') },
      experiences: { description: 'experience files', dir: path.join(basePath, 'experience') },
      output: { description: 'all output files', dir: path.join(basePath, 'output') },
    };

    function cleanDirectoryContents(dirPath: string): number {
      let count = 0;
      for (const item of fs.readdirSync(dirPath)) {
        const itemPath = path.join(dirPath, item);
        if (fs.statSync(itemPath).isDirectory()) {
          count += cleanDirectoryContents(itemPath);
          fs.rmSync(itemPath, { recursive: true });
        } else {
          fs.unlinkSync(itemPath);
          count++;
        }
      }
      return count;
    }

    function cleanTarget(name: string): void {
      const t = targets[name];
      if (!fs.existsSync(t.dir)) {
        console.log(`${name}: nothing to clean (${t.dir} not found)`);
        return;
      }
      const count = cleanDirectoryContents(t.dir);
      console.log(`Cleaned ${count} ${t.description} files from ${t.dir}`);
    }

    try {
      if (target && !targets[target]) {
        console.error(`Unknown target: ${target}. Available: ${Object.keys(targets).join(', ')}`);
        process.exit(1);
      }

      if (!target) {
        cleanTarget('output');
        cleanTarget('experiences');
      } else {
        cleanTarget(target);
      }

      console.log('Cleanup completed successfully!');
    } catch (error) {
      console.error('Failed to clean:', error);
      process.exit(1);
    }
  });

program
  .command('learn [url] [description]')
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

addCommonOptions(program.command('research <url>').description('Research a page and print UI analysis').option('--data', 'Include data extraction in research').option('--deep', 'Enable deep analysis (expand hidden elements)').option('--no-fix', 'Skip locator fix cycle (for debugging)')).action(
  async (url, options) => {
    try {
      const explorBot = new ExplorBot(buildExplorBotOptions(url, options));
      await explorBot.start();

      const argParts: string[] = [url];
      if (options.data) argParts.push('--data');
      if (options.deep) argParts.push('--deep');
      if (options.fix === false) argParts.push('--no-fix');

      const { ResearchCommand } = await import('../src/commands/research-command.js');
      await new ResearchCommand(explorBot).execute(argParts.join(' '));

      await explorBot.stop();
      await showStatsAndExit(0);
    } catch (error) {
      console.error('Failed:', error instanceof Error ? error.message : 'Unknown error');
      await showStatsAndExit(1);
    }
  }
);

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
  .option('--session [file]', 'Save/restore browser session from file')
  .option('--full', 'Include HTML and all data')
  .option('--compact', 'Compact view with summaries')
  .option('--attached', 'Only auto-attached sections (default)')
  .option('--visual', 'Annotate elements on screenshot and print screenshot path')
  .option('--screenshot', 'Alias for --visual')
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

      const { ContextCommand } = await import('../src/commands/context-command.js');
      const argParts: string[] = [];
      if (options.full) argParts.push('--full');
      else if (options.compact) argParts.push('--compact');
      else argParts.push('--attached');
      if (options.visual || options.screenshot) argParts.push('--visual');
      await new ContextCommand(explorBot).execute(argParts.join(' '));

      await explorBot.stop();
      await showStatsAndExit(0);
    } catch (error) {
      console.error('Failed:', error instanceof Error ? error.message : 'Unknown error');
      await showStatsAndExit(1);
    }
  });

addCommonOptions(program.command('shell <url> <command>').description('Execute a CodeceptJS command on a page and exit')).action(async (url, command, options) => {
  try {
    const explorBot = new ExplorBot(buildExplorBotOptions(url, options));
    await explorBot.start();
    await explorBot.agentNavigator().visit(url);

    const action = explorBot.getExplorer().createAction();
    await action.execute(command);

    log('Command executed successfully');
    const state = explorBot.getExplorer().getStateManager().getCurrentState();
    if (state) log(`URL: ${state.url}`);

    await explorBot.stop();
    await showStatsAndExit(0);
  } catch (error) {
    console.error('Failed:', error instanceof Error ? error.message : 'Unknown error');
    await showStatsAndExit(1);
  }
});

const browserCmd = program.command('browser').description('Manage persistent browser server');

browserCmd
  .command('start')
  .description('Launch a persistent browser server')
  .option('-s, --show', 'Launch browser in headed mode (visible window)')
  .option('--headless', 'Launch browser in headless mode')
  .option('-c, --config <path>', 'Path to configuration file')
  .option('-p, --path <path>', 'Working directory path')
  .action(async (options) => {
    const { launchServer, removeEndpointFile } = await import('../src/browser-server.js');
    await ConfigParser.getInstance().loadConfig({ config: options.config, path: options.path });
    const config = ConfigParser.getInstance().getConfig();

    let show = config.playwright.show || false;
    if (options.show !== undefined) show = true;
    if (options.headless !== undefined) show = false;

    const server = await launchServer({ browser: config.playwright.browser, show });

    console.log('Browser server is running. Press Ctrl+C to stop.');

    const cleanup = () => {
      console.log('\nStopping browser server...');
      server.close();
      removeEndpointFile();
      process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  });

browserCmd
  .command('stop')
  .description('Stop a running browser server')
  .option('-c, --config <path>', 'Path to configuration file')
  .option('-p, --path <path>', 'Working directory path')
  .action(async (options) => {
    const { getAliveEndpoint, removeEndpointFile } = await import('../src/browser-server.js');
    await ConfigParser.getInstance().loadConfig({ config: options.config, path: options.path });

    const endpoint = await getAliveEndpoint();
    if (!endpoint) {
      console.log('No running browser server found.');
      process.exit(0);
    }

    try {
      const { chromium } = await import('playwright-core');
      const browser = await chromium.connect(endpoint, { timeout: 3000 });
      await browser.close();
    } catch {}

    removeEndpointFile();
    console.log('Browser server stopped.');
  });

browserCmd
  .command('status')
  .description('Check if a browser server is running')
  .option('-c, --config <path>', 'Path to configuration file')
  .option('-p, --path <path>', 'Working directory path')
  .action(async (options) => {
    const { getAliveEndpoint } = await import('../src/browser-server.js');
    await ConfigParser.getInstance().loadConfig({ config: options.config, path: options.path });

    const endpoint = await getAliveEndpoint();
    if (endpoint) {
      console.log(`Browser server is running at: ${endpoint}`);
    } else {
      console.log('No running browser server found.');
    }
  });

program
  .command('extract-styles <agent>')
  .description('Extract built-in planning styles to a directory for customization')
  .option('-d, --dir <path>', 'Target directory (default: ./rules/<agent>/styles)')
  .action(async (agent, options) => {
    try {
      const { RulesLoader } = await import('../src/utils/rules-loader.js');
      const targetDir = options.dir || path.resolve(`./rules/${agent}/styles`);
      const extracted = RulesLoader.extractStyles(agent, targetDir);
      if (extracted.length === 0) {
        console.log('All style files already exist in target directory.');
      } else {
        console.log(`\nExtracted ${extracted.length} style files to ${targetDir}`);
      }
    } catch (error) {
      console.error('Failed:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

program
  .command('add-rule [agent] [name]')
  .alias('rules:add')
  .description('Create a rule file for an agent')
  .option('--url <pattern>', 'URL pattern for this rule')
  .option('-p, --path <path>', 'Working directory path')
  .action(async (agent, name, options) => {
    if (options.path) process.chdir(path.resolve(options.path));

    if (agent && name) {
      const { AddRuleCommand } = await import('../src/commands/add-rule-command.js');
      const result = AddRuleCommand.createRuleFile(agent, name, { urlPattern: options.url });
      process.exit(result ? 0 : 1);
    }

    const AddRule = (await import('../src/components/AddRule.js')).default;
    render(React.createElement(AddRule, { initialAgent: agent || '', initialName: name || '' }), {
      exitOnCtrlC: false,
      patchConsole: false,
    });
  });

import { createApiCommands } from '../boat/api-tester/src/cli.ts';
program.addCommand(createApiCommands('api'));

program.parse();
