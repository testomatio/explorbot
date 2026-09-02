import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { ConfigCommand } from '../../../src/commands/config-command.ts';
import { remote } from '../../../src/remote.ts';
import { isVerboseMode, setPreserveConsoleLogs, setQuietMode } from '../../../src/utils/logger.ts';
import { DocBot, type DocbotOptions } from './docbot.ts';

function buildOptions(options: any): DocbotOptions {
  return {
    verbose: options.verbose || options.debug,
    config: options.config,
    path: options.path,
    show: options.show,
    headless: options.headless,
    incognito: options.incognito,
    session: options.session,
    docsConfig: options.docsConfig,
    baseUrl: options.url,
  };
}

function addCommonOptions(cmd: Command): Command {
  return cmd
    .option('-v, --verbose', 'Enable verbose logging')
    .option('--debug', 'Enable debug logging')
    .option('-c, --config <path>', 'Path to explorbot configuration file')
    .option('--docs-config <path>', 'Path to doc collector configuration file')
    .option('-p, --path <path>', 'Working directory path')
    .option('--url <url>', 'Base URL of the site, when the path argument is relative (env: EXPLORBOT_URL)')
    .option('-s, --show', 'Show browser window')
    .option('--headless', 'Run browser in headless mode')
    .option('--incognito', 'Run without recording experiences')
    .option('--session [file]', 'Save/restore browser session from file');
}

export function createDocsCommands(name = 'docs'): Command {
  const cmd = new Command(name);
  cmd.description('AI-powered website documentation collector');

  addCommonOptions(
    cmd
      .command('collect <path>')
      .description('Crawl pages and generate documentation spec')
      .option('--max-pages <count>', 'Maximum number of pages to document')
      .option('--no-collapse-template-pages', 'Visit every page even when its layout matches a documented page')
      .option('--template-similarity <percent>', 'Structural similarity percent that counts pages as the same layout (default 90)')
  ).action(async (startPath, options) => {
    setPreserveConsoleLogs(true);

    try {
      const bot = new DocBot({
        ...buildOptions(options),
        startUrl: startPath,
      });
      await bot.start();

      let maxPages: number | undefined;
      if (options.maxPages) {
        maxPages = Number.parseInt(options.maxPages, 10);
      }
      let templateSimilarity: number | undefined;
      if (options.templateSimilarity) {
        templateSimilarity = Number.parseInt(options.templateSimilarity, 10);
      }

      const result = await bot.collect(startPath, { maxPages, collapseTemplatePages: options.collapseTemplatePages, templateSimilarity });

      console.log(`\nDocumented ${result.pages.length} page(s)`);
      console.log(`Skipped ${result.skipped.length} page(s)`);
      console.log(`Spec index: ${result.indexPath}`);
      console.log(`Pages dir: ${path.join(result.outputDir, 'pages')}`);
      console.log(`Use in Explorbot: npx explorbot start ${startPath} --spec "${result.outputDir}"`);

      await bot.stop();
      await remote.close(0);
      process.exit(0);
    } catch (error) {
      console.error('Failed:', error instanceof Error ? error.message : 'Unknown error');
      await remote.close(1);
      process.exit(1);
    }
  });

  addCommonOptions(cmd.command('config [url]').description('Show models, config file and paths used by this run'))
    .option('--json', 'Print the resolved config as JSON')
    .action(async (url, options) => {
      setQuietMode(!isVerboseMode());
      try {
        console.log(await ConfigCommand.summary({ config: options.config, path: options.path, url: url || options.url, json: options.json }));
      } catch (error) {
        console.error(error instanceof Error ? error.message : 'Unknown error');
        process.exit(1);
      }
    });

  cmd
    .command('init')
    .description('Initialize doc collector configuration')
    .option('-f, --force', 'Overwrite existing config file')
    .option('-p, --path <path>', 'Working directory for initialization')
    .action(async (options) => {
      const originalCwd = process.cwd();
      if (options.path) {
        const resolvedPath = path.resolve(options.path);
        fs.mkdirSync(resolvedPath, { recursive: true });
        process.chdir(resolvedPath);
        console.log(`Working in: ${resolvedPath}`);
      }

      const configPath = path.resolve('docbot.config.ts');
      if (fs.existsSync(configPath) && !options.force) {
        console.log(`Config file already exists: ${configPath}`);
        console.log('Use --force to overwrite.');
        process.exit(1);
      }

      const configContent = `export default {
          docs: {
            maxPages: 100,
            output: 'docs',
            screenshot: true,
            interactive: false,
            ignoreErrors: true,
            collapseDynamicPages: true,
            collapseTemplatePages: true,
            templateSimilarity: 90,
            scope: 'site',
            includePaths: [],
            excludePaths: [],
            deniedPathSegments: ['callback', 'callbacks', 'logout', 'signout', 'sign_out', 'destroy', 'delete', 'remove'],
            deniedActionLabels: ['delete', 'remove', 'destroy', 'archive', 'discard', 'logout', 'sign out', 'signout', 'sign_out', 'erase', 'drop'],
            maxPrimaryCandidates: 3,
            maxInteractions: 5,
            minCanActions: 1,
            minInteractiveElements: 3,
            // prompt: 'Add domain-specific documentation guidance here',
          },
        };
      `;

      fs.writeFileSync(configPath, configContent, 'utf8');
      console.log(`Created: ${configPath}`);

      if (process.cwd() !== originalCwd) {
        process.chdir(originalCwd);
      }
    });

  return cmd;
}
