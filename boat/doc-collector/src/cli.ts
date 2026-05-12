import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { setPreserveConsoleLogs } from '../../../src/utils/logger.ts';
import { DocBot, type DocbotOptions } from './docbot.ts';

function buildOptions(options: any): DocbotOptions {
  let session = options.session;
  if (options.session === true) {
    session = 'output/session.json';
  }

  return {
    verbose: options.verbose || options.debug,
    config: options.config,
    path: options.path,
    show: options.show,
    headless: options.headless,
    incognito: options.incognito,
    session,
    docsConfig: options.docsConfig,
  };
}

function addCommonOptions(cmd: Command): Command {
  return cmd
    .option('-v, --verbose', 'Enable verbose logging')
    .option('--debug', 'Enable debug logging')
    .option('-c, --config <path>', 'Path to explorbot configuration file')
    .option('--docs-config <path>', 'Path to doc collector configuration file')
    .option('-p, --path <path>', 'Working directory path')
    .option('-s, --show', 'Show browser window')
    .option('--headless', 'Run browser in headless mode')
    .option('--incognito', 'Run without recording experiences')
    .option('--session [file]', 'Save/restore browser session from file');
}

export function createDocsCommands(name = 'docs'): Command {
  const cmd = new Command(name);
  cmd.description('AI-powered website documentation collector');

  addCommonOptions(cmd.command('collect <path>').description('Crawl pages and generate documentation spec').option('--max-pages <count>', 'Maximum number of pages to document')).action(async (startPath, options) => {
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

      const result = await bot.collect(startPath, { maxPages });

      console.log(`\nDocumented ${result.pages.length} page(s)`);
      console.log(`Skipped ${result.skipped.length} page(s)`);
      console.log(`Spec index: ${result.indexPath}`);
      console.log(`Pages dir: ${path.join(result.outputDir, 'pages')}`);

      await bot.stop();
      process.exit(0);
    } catch (error) {
      console.error('Failed:', error instanceof Error ? error.message : 'Unknown error');
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
            collapseDynamicPages: true,
            scope: 'site',
            includePaths: [],
            excludePaths: [],
            deniedPathSegments: ['callback', 'callbacks', 'logout', 'signout', 'sign_out', 'destroy', 'delete', 'remove'],
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
