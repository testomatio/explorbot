import { existsSync } from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { type AIConfig, ConfigParser, EXPLORBOT_ENV_VARS, type ReporterConfig, configuredModels } from '../config.js';
import { listSites } from '../global-config.js';
import { Reporter } from '../reporter.js';
import { getCliName } from '../utils/cli-name.js';
import { renderSection } from '../utils/cli-section.js';
import { tag } from '../utils/logger.js';
import { BaseCommand } from './base-command.js';

export class ConfigCommand extends BaseCommand {
  name = 'config';
  description = 'Show models, config file and paths used by this run';

  async execute(): Promise<void> {
    const parser = ConfigParser.getInstance();
    tag('info').log(ConfigCommand.render(this.explorBot.getConfig(), { configPath: parser.getConfigPath(), root: parser.getProjectRoot() }));
  }

  static async summary(options: { config?: string; path?: string; url?: string; json?: boolean } = {}): Promise<string> {
    const parser = ConfigParser.getInstance();
    const [site] = listSites();
    const load = (baseUrl?: string) => parser.loadConfig({ config: options.config, path: options.path, baseUrl });

    const config = await load(options.url).catch((error) => {
      if (!site) throw error;
      return load(site.url);
    });

    return ConfigCommand.render(config, { configPath: parser.getConfigPath(), root: parser.getProjectRoot(), json: options.json });
  }

  static data(config: SummarizedConfig, options: ConfigSummaryOptions = {}): ConfigData {
    let configPath = '';
    if (options.configPath && existsSync(options.configPath)) configPath = options.configPath;

    const dirs: Record<string, string> = {};
    if (options.root) {
      for (const [name, dir] of Object.entries({ output: 'output', ...config.dirs })) {
        dirs[name] = path.resolve(options.root, dir);
      }
    }

    const env: Record<string, string> = {};
    for (const variable of EXPLORBOT_ENV_VARS) {
      const value = process.env[variable.name];
      if (value) env[variable.name] = value;
    }

    const models: Record<string, string> = {};
    const providers: Record<string, string> = {};
    for (const [role, model] of Object.entries(configuredModels(config.ai))) {
      models[role] = model.name;
      if (model.provider) providers[role] = model.provider;
    }

    return {
      config: configPath,
      url: config.playwright?.url || config.web?.url || config.api?.baseEndpoint || '',
      browser: config.playwright?.browser || '',
      headless: !config.playwright?.show,
      dirs,
      models,
      providers,
      integrations: {
        langfuse: !!config.ai?.langfuse?.enabled,
        testomatio: Reporter.resolveEnabled(config.reporter),
      },
      env,
    };
  }

  static render(config: SummarizedConfig, options: ConfigSummaryOptions = {}): string {
    const data = ConfigCommand.data(config, options);
    if (options.json) return JSON.stringify(data, null, 2);

    const lines: string[] = [];
    const section = (title: string, entries: [string, string][]) => lines.push(...renderSection(title, entries));

    const general: [string, string][] = [['config', data.config || 'EXPLORBOT_* environment variables']];
    if (data.url) general.push(['url', data.url]);
    if (data.browser) {
      let window = 'visible';
      if (data.headless) window = 'headless';
      general.push(['browser', `${data.browser}, ${window}`]);
    }
    for (const [name, dir] of Object.entries(data.dirs)) general.push([name, dir]);
    section('Config', general);

    const providerWidth = Math.max(0, ...Object.values(data.providers).map((provider) => provider.length));
    const models: [string, string][] = Object.entries(data.models).map(([role, model]) => {
      if (!providerWidth) return [role, model];
      return [role, `${chalk.dim((data.providers[role] || '').padEnd(providerWidth))}  ${model}`];
    });
    if (!models.length) models.push(['model', chalk.red(`not configured — run ${getCliName()} init`)]);
    section('Models', models);

    const integrations: [string, string][] = [];
    if (data.integrations.langfuse) integrations.push(['langfuse', 'traces sent']);
    if (data.integrations.testomatio) integrations.push(['testomatio', 'runs reported']);
    section('Integrations', integrations);

    const env: [string, string][] = Object.entries(data.env).map(([name, value]) => {
      let shown = value;
      if (shown.length > 60) shown = `${shown.slice(0, 57)}...`;
      return [name, shown];
    });
    section('Environment', env);

    lines.push(chalk.dim(`Every EXPLORBOT_* variable: ${getCliName()} --help`));
    return lines.join('\n');
  }
}

interface ConfigSummaryOptions {
  configPath?: string | null;
  root?: string;
  json?: boolean;
}

export interface ConfigData {
  config: string;
  url: string;
  browser: string;
  headless: boolean;
  dirs: Record<string, string>;
  models: Record<string, string>;
  providers: Record<string, string>;
  integrations: { langfuse: boolean; testomatio: boolean };
  env: Record<string, string>;
}

interface SummarizedConfig {
  ai?: AIConfig;
  playwright?: { url?: string; browser?: string; show?: boolean };
  web?: { url?: string };
  api?: { baseEndpoint?: string };
  dirs?: Record<string, string>;
  reporter?: ReporterConfig;
}
