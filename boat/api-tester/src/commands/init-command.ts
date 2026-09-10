import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { envTemplate, modelLines } from '../../../../src/commands/init-command.ts';
import { missingModelRoles } from '../../../../src/config.ts';
import { log, tag } from '../../../../src/utils/logger.ts';

export async function runInit(options: InitOptions): Promise<void> {
  const provider = options.provider || 'openrouter';
  const originalCwd = process.cwd();

  if (options.path) {
    const dir = path.resolve(options.path);
    mkdirSync(dir, { recursive: true });
    process.chdir(dir);
    log(`Working in directory: ${dir}`);
  }

  const configPath = path.resolve('apibot.config.js');
  if (existsSync(configPath) && !options.force) {
    log(`Config file already exists: ${configPath}`);
    log('Use --force to overwrite existing file');
    process.exit(1);
  }

  const answers = await ask(options);
  if (!answers.baseEndpoint) {
    tag('error').log('Base endpoint is required.');
    process.exit(1);
  }

  if (!answers.spec) {
    tag('error').log('OpenAPI spec is required. Chief plans from it and Curler looks up schemas in it.');
    process.exit(1);
  }

  writeFileSync(configPath, configTemplate(provider, answers.baseEndpoint, answers.spec), 'utf8');
  log(`Created config file: ${configPath}`);

  const envPath = path.resolve('.env');
  if (!existsSync(envPath)) {
    writeFileSync(envPath, `${envTemplate(provider)}\n`, 'utf8');
    log(`Created env file: ${envPath}`);
  }

  mkdirSync('output', { recursive: true });
  mkdirSync('knowledge', { recursive: true });

  if (answers.knowledge) {
    const knowledgePath = path.resolve('knowledge', 'general.md');
    writeFileSync(knowledgePath, `---\nendpoint: "*"\n---\n${answers.knowledge}\n`, 'utf8');
    log(`Created knowledge file: ${knowledgePath}`);
  }

  const missing = missingModelRoles(provider);
  if (missing.length) {
    tag('warning').log(`No recommended ${missing.join(' and ')} for ${provider} — set the model ids in ${configPath}`);
  }

  log('');
  log('Next steps:');
  log('1. Add your provider API key to .env');
  log('2. Describe the API so the plans match it');
  tag('substep').log(chalk.yellow(`${options.prefix} know /users "CRUD endpoint for user management"`));
  log('3. Plan and run tests for one endpoint');
  tag('substep').log(chalk.yellow(`${options.prefix} explore /users`));

  if (process.cwd() !== originalCwd) process.chdir(originalCwd);
}

function configTemplate(provider: string, baseEndpoint: string, spec: string): string {
  return `// Models are written as 'provider/model-id' so they resolve without a local node_modules.
// https://github.com/testomatio/explorbot/blob/main/docs/basics/providers.md

export default {
  ai: {
${modelLines(provider, ['model', 'agenticModel'])}
  },

  api: {
    baseEndpoint: '${baseEndpoint}',
    spec: ['${spec}'],
  },
};
`;
}

async function ask(options: InitOptions): Promise<Answers> {
  if (options.baseEndpoint) {
    return { baseEndpoint: options.baseEndpoint, spec: options.spec || '', knowledge: '' };
  }

  const rl = await import('node:readline');
  const iface = rl.createInterface({ input: process.stdin, output: process.stdout });
  const question = (text: string): Promise<string> => new Promise((resolve) => iface.question(text, (answer: string) => resolve(answer.trim())));

  log('Apibot — API Testing Tool Setup\n');
  const baseEndpoint = await question('Base API endpoint (e.g. https://api.example.com/v1): ');
  const spec = await question('OpenAPI spec file or URL: ');
  const knowledge = await question('Describe your API, its auth and its rules (Enter to skip): ');
  iface.close();

  return { baseEndpoint, spec, knowledge };
}

interface InitOptions {
  force?: boolean;
  path?: string;
  provider?: string;
  baseEndpoint?: string;
  spec?: string;
  prefix: string;
}

interface Answers {
  baseEndpoint: string;
  spec: string;
  knowledge: string;
}
