import { Command } from 'commander';
import { ConfigCommand } from '../../../src/commands/config-command.ts';
import { RecommendedModelsCommand } from '../../../src/commands/recommended-models-command.ts';
import { listSites } from '../../../src/global-config.ts';
import { setPreserveConsoleLogs } from '../../../src/utils/logger.ts';
import { ApiBot, type ApibotOptions } from './apibot.ts';
import { ExploreCommand } from './commands/explore-command.ts';
import { runInit } from './commands/init-command.ts';
import { KnowCommand } from './commands/know-command.ts';
import { PlanCommand } from './commands/plan-command.ts';
import { TestCommand } from './commands/test-command.ts';
import { ApibotConfigParser } from './config.ts';

export function createApiCommands(name = 'api'): Command {
  const cmd = new Command(name);
  cmd.description('AI-powered API testing tool');

  addCommonOptions(cmd.command('plan <endpoint>').description('Generate test plan for an API endpoint'))
    .option('--style <style>', 'Planning style: basename of a file in rules/chief/styles/')
    .option('--fresh', 'Start planning from scratch')
    .action(async (endpoint, options) => {
      await run(name, options, endpoint, async (bot) => {
        const command = new PlanCommand(bot);
        command.prefix = name;
        command.style = options.style;
        command.fresh = !!options.fresh;
        await command.execute(endpoint);
        return 0;
      });
    });

  addCommonOptions(cmd.command('config [endpoint]').description('Show models, config file and paths used by this run'))
    .option('--json', 'Print the resolved config as JSON')
    .action(async (endpoint, options) => {
      const parser = ApibotConfigParser.getInstance();
      const [site] = listSites();
      const runOptions = buildOptions(options);
      runOptions.endpoint = endpoint || site?.url;
      if (runOptions.endpoint && URL.canParse(runOptions.endpoint)) runOptions.baseEndpoint ||= runOptions.endpoint;
      try {
        const config = await parser.loadConfig(runOptions);
        console.log(ConfigCommand.render(config, { configPath: parser.getConfigPath(), root: parser.getProjectRoot(), json: options.json }));
      } catch (error) {
        console.error(error instanceof Error ? error.message : 'Unknown error');
        process.exit(1);
      }
    });

  RecommendedModelsCommand.register(cmd);

  addCommonOptions(cmd.command('test <planfile> [index]').description('Execute tests from a plan file. Index: 1, 1-3, *')).action(async (planfile, index, options) => {
    await run(name, options, undefined, async (bot) => {
      const command = new TestCommand(bot);
      command.index = index;
      await command.execute(planfile);
      if (command.failed) return 1;
      return 0;
    });
  });

  addCommonOptions(cmd.command('explore <endpoint>').description('Full cycle: plan, execute tests, re-plan. Use * to cover many endpoints, or the base endpoint for all of them')).action(async (endpoint, options) => {
    await run(name, options, endpoint, async (bot) => {
      const command = new ExploreCommand(bot);
      await command.execute(endpoint);
      if (command.result.failed) return 1;
      return 0;
    });
  });

  cmd
    .command('init')
    .description('Initialize a new apibot project with configuration')
    .option('-f, --force', 'Overwrite existing config file')
    .option('-p, --path <path>', 'Working directory for initialization')
    .option('--provider <name>', 'AI provider written into the config')
    .option('--endpoint <url>', 'Base API endpoint, skips the questions')
    .option('--spec <path>', 'OpenAPI spec file or URL')
    .action(async (options) => {
      await runInit({ ...options, baseEndpoint: options.endpoint, prefix: name });
    });

  cmd
    .command('know <endpoint> [description]')
    .alias('add-knowledge')
    .description('Add API knowledge for an endpoint')
    .option('-c, --config <path>', 'Path to configuration file')
    .option('-p, --path <path>', 'Working directory path')
    .action(async (endpoint, description, options) => {
      const command = new KnowCommand(new ApiBot(buildOptions(options)));
      command.prefix = name;
      command.knowledge = description || (await askDescription(endpoint));
      try {
        await command.execute(endpoint);
      } catch (error) {
        console.error(error instanceof Error ? error.message : 'Unknown error');
        process.exit(1);
      }
    });

  return cmd;
}

async function run(name: string, options: any, endpoint: string | undefined, body: (bot: ApiBot) => Promise<number>): Promise<void> {
  setPreserveConsoleLogs(true);
  try {
    if (endpoint && URL.canParse(endpoint)) options.endpoint ||= endpoint;
    const bot = new ApiBot({ ...buildOptions(options), endpoint });
    await bot.start();
    const code = await body(bot);
    await bot.stop();
    process.exit(code);
  } catch (error) {
    console.error('Failed:', error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}

async function askDescription(endpoint: string): Promise<string> {
  const rl = await import('node:readline');
  const iface = rl.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => iface.question(`Describe ${endpoint}: `, (text: string) => resolve(text.trim())));
  iface.close();
  return answer;
}

function buildOptions(options: any): ApibotOptions {
  return {
    verbose: options.verbose || options.debug,
    config: options.config,
    path: options.path,
    baseEndpoint: options.endpoint,
    spec: options.spec,
    header: options.header,
  };
}

function addCommonOptions(cmd: Command): Command {
  return cmd
    .option('-v, --verbose', 'Enable verbose logging')
    .option('--debug', 'Enable debug logging')
    .option('-c, --config <path>', 'Path to configuration file')
    .option('-p, --path <path>', 'Working directory path')
    .option('--endpoint <url>', 'Base API endpoint to test (env: EXPLORBOT_URL)')
    .option('--spec <path>', 'OpenAPI spec file or URL (env: EXPLORBOT_API_SPEC)')
    .option('-H, --header <header>', 'Header sent with every request, as "Name: value". Repeatable (env: EXPLORBOT_API_HEADERS)', (value: string, previous: string[] = []) => [...previous, value]);
}
