import chalk from 'chalk';
import type { Command } from 'commander';
import { ConfigParser, EXPLORBOT_ENV_VARS, MODEL_ROLES, PROVIDERS } from '../config.js';
import { getCliName } from '../utils/cli-name.js';
import { renderSection } from '../utils/cli-section.js';
import { tag } from '../utils/logger.js';
import { BaseCommand } from './base-command.js';

const DESCRIPTION = 'Show the models recommended for every AI provider';

const ROLES: Record<string, { hint: string; env: string }> = {
  model: { hint: 'fast', env: 'EXPLORBOT_AI_MODEL' },
  visionModel: { hint: 'screenshots', env: 'EXPLORBOT_VISION_MODEL' },
  agenticModel: { hint: 'smart', env: 'EXPLORBOT_AGENTIC_MODEL' },
};

const MODEL_ENV_VARS = MODEL_ROLES.map((role) => ROLES[role].env);

export class RecommendedModelsCommand extends BaseCommand {
  name = 'recommended-models';
  description = DESCRIPTION;

  async execute(): Promise<void> {
    tag('info').log(RecommendedModelsCommand.render());
  }

  static register(program: Command): void {
    program
      .command('recommended-models')
      .description(DESCRIPTION)
      .option('--json', 'Print the recommendations as JSON')
      .action((options) => console.log(RecommendedModelsCommand.render(options.json)));
  }

  static render(json = false): string {
    const recommended = ConfigParser.recommendedModels();
    if (json) return JSON.stringify(recommended, null, 2);

    const lines = [
      chalk.bold('Export the provider key, then pick one of two ways to select models:'),
      `  ${chalk.bold('EXPLORBOT_AI_PROVIDER')} — every role takes that provider's recommendation below`,
      `  ${chalk.bold(MODEL_ENV_VARS.join(' + '))} — no provider variable, pin every role yourself as ${chalk.dim('provider/model-id')}`,
      '',
    ];

    for (const [provider, roles] of Object.entries(recommended)) {
      lines.push(chalk.bold.yellow(`${provider}:`));

      const models: [string, string][] = [];
      for (const role of MODEL_ROLES) {
        const label = `${role} (${ROLES[role].hint})`;
        if (roles[role]) models.push([label, roles[role]]);
        if (!roles[role]) models.push([label, chalk.dim('not served, pair with another provider')]);
      }
      lines.push(...renderSection('models', models, 2));

      const envKey = PROVIDERS[provider]?.envKey;
      if (!envKey) {
        lines.push(`  ${chalk.dim('not bundled — import the provider in your config')}`, '');
        continue;
      }

      const env: [string, string][] = [
        ['key', envKey],
        ['provider', `EXPLORBOT_AI_PROVIDER=${provider}`],
      ];
      let label = 'or models';
      for (const role of MODEL_ROLES) {
        if (!roles[role]) continue;
        env.push([label, `${ROLES[role].env}=${provider}/${roles[role]}`]);
        label = '';
      }
      lines.push(...renderSection('env variables', env, 2));
    }

    const modelVars = ['EXPLORBOT_AI_PROVIDER', ...MODEL_ENV_VARS];
    const current: [string, string][] = [];
    for (const variable of EXPLORBOT_ENV_VARS) {
      if (!modelVars.includes(variable.name)) continue;
      if (process.env[variable.name]) current.push([variable.name, process.env[variable.name]!]);
    }
    for (const [provider, { envKey }] of Object.entries(PROVIDERS)) {
      if (process.env[envKey]) current.push([envKey, chalk.dim(`set, ${provider} usable`)]);
    }

    if (!current.length) lines.push(chalk.dim('Nothing set — export one of the variables above, or write models into your config'), '');
    if (current.length) lines.push(...renderSection('Currently set', current));

    lines.push(chalk.bold('Example using OpenRouter:'), `  OPENROUTER_API_KEY=sk-... EXPLORBOT_AI_PROVIDER=openrouter ${getCliName()} <command>`);
    return lines.join('\n');
  }
}
