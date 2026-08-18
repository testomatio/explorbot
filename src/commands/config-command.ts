import { existsSync } from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { type AIConfig, ConfigParser, EXPLORBOT_ENV_VARS, type ReporterConfig, configuredModels } from '../config.js';
import { listSites } from '../global-config.js';
import { Reporter } from '../reporter.js';
import { getCliName } from '../utils/cli-name.js';
import { tag } from '../utils/logger.js';
import { BaseCommand } from './base-command.js';

export class ConfigCommand extends BaseCommand {
  name = 'config';
  description = 'Show models, config file and paths used by this run';

  async execute(): Promise<void> {
    const parser = ConfigParser.getInstance();
    tag('info').log(ConfigCommand.render(this.explorBot.getConfig(), { configPath: parser.getConfigPath(), root: parser.getProjectRoot() }));
  }

  static async summary(options: { config?: string; path?: string; url?: string } = {}): Promise<string> {
    const parser = ConfigParser.getInstance();
    const [site] = listSites();
    const load = (baseUrl?: string) => parser.loadConfig({ config: options.config, path: options.path, baseUrl });

    const config = await load(options.url).catch((error) => {
      if (!site) throw error;
      return load(site.url);
    });

    return ConfigCommand.render(config, { configPath: parser.getConfigPath(), root: parser.getProjectRoot() });
  }

  static render(config: SummarizedConfig, options: ConfigSummaryOptions = {}): string {
    const lines: string[] = [];
    const section = (title: string, entries: [string, string][]) => {
      if (!entries.length) return;
      const width = Math.max(...entries.map(([label]) => label.length));
      lines.push(chalk.bold(title));
      for (const [label, value] of entries) lines.push(`  ${chalk.dim(label.padEnd(width))}  ${value}`);
      lines.push('');
    };

    let source = 'EXPLORBOT_* environment variables';
    if (options.configPath && existsSync(options.configPath)) source = options.configPath;

    const general: [string, string][] = [['config', source]];
    const url = config.playwright?.url || config.web?.url || config.api?.baseEndpoint;
    if (url) general.push(['url', url]);
    if (config.playwright?.browser) {
      let window = 'headless';
      if (config.playwright.show) window = 'visible';
      general.push(['browser', `${config.playwright.browser}, ${window}`]);
    }
    if (options.root) {
      const dirs: Record<string, string> = { output: 'output', ...config.dirs };
      for (const [name, dir] of Object.entries(dirs)) general.push([name, path.join(options.root, dir)]);
    }
    section('Config', general);

    const models: [string, string][] = Object.entries(configuredModels(config.ai));
    if (!models.length) models.push(['model', chalk.red(`not configured — run ${getCliName()} init`)]);
    section('Models', models);

    const integrations: [string, string][] = [];
    if (config.ai?.langfuse?.enabled) integrations.push(['langfuse', 'traces sent']);
    if (Reporter.resolveEnabled(config.reporter)) integrations.push(['testomatio', 'runs reported']);
    section('Integrations', integrations);

    const env: [string, string][] = [];
    for (const variable of EXPLORBOT_ENV_VARS) {
      const value = process.env[variable.name];
      if (!value) continue;
      let shown = value;
      if (shown.length > 60) shown = `${shown.slice(0, 57)}...`;
      env.push([variable.name, shown]);
    }
    section('Environment', env);

    lines.push(chalk.dim(`Every EXPLORBOT_* variable: ${getCliName()} --help`));
    return lines.join('\n');
  }
}

interface ConfigSummaryOptions {
  configPath?: string | null;
  root?: string;
}

interface SummarizedConfig {
  ai?: AIConfig;
  playwright?: { url?: string; browser?: string; show?: boolean };
  web?: { url?: string };
  api?: { baseEndpoint?: string };
  dirs?: Record<string, string>;
  reporter?: ReporterConfig;
}
