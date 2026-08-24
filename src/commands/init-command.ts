import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import chalk from 'chalk';
import dedent from 'dedent';
import { ConfigParser, PROVIDERS } from '../config.ts';
import { findGlobalConfig, globalConfigPath, globalDir, globalEnvPath } from '../global-config.ts';
import { getCliName } from '../utils/cli-name.ts';
import { log, tag } from '../utils/logger.js';
import { relativeToCwd } from '../utils/next-steps.ts';

function defaultConfigTemplate(): string {
  return `// Models are written as 'provider/model-id' so they resolve without installing a provider package.
// Vercel AI SDK is used to connect to AI providers.
// Bring your own provider by installing its package and importing it here:
//   npm i @ai-sdk/openai
//   import { createOpenAI } from '@ai-sdk/openai';
//   const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
// https://github.com/testomatio/explorbot/blob/main/docs/basics/providers.md

const config = {
  web: {
    // use application host without path prefix (e.g., http://localhost:3000)
    url: 'http://<your-app-host-here>',
  },

  ai: {
${modelLines('openrouter')}
  },

  reporter: {
    // Save a local HTML report after each run.
    html: true,
    // Save a local markdown report after each run.
    markdown: true,
    // Group runs by title in Testomat.io / HTML reports. Defaults to today's date — customize or remove.
    runGroup: new Date().toISOString().slice(0, 10),
  },
};

export default config;
`;
}

const DEFAULT_ENV_TEMPLATE = dedent`
# AI provider API keys
OPENROUTER_API_KEY=

# OPENAI_API_KEY=
# ANTHROPIC_API_KEY=
# GROQ_API_KEY=

# Langfuse Tracing
LANGFUSE_SECRET_KEY=
LANGFUSE_PUBLIC_KEY=
LANGFUSE_BASE_URL=

# Testomat.io API key to publish run results
TESTOMATIO=
`;

export async function runInit(options: InitCommandOptions): Promise<void> {
  if (options.global || options.provider) {
    await runGlobalInit(options);
    return;
  }

  if (options.configPath || options.path || !process.stdin.isTTY) {
    runInitCommand(options);
    return;
  }

  const choice = await renderInitWizard('choose');
  if (choice === 'local') runInitCommand(options);
}

export function writeGlobalConfig(provider: string, apiKey?: string): void {
  if (!PROVIDERS[provider]) {
    throw new Error(`Unknown AI provider "${provider}". Supported providers: ${Object.keys(PROVIDERS).join(', ')}`);
  }

  mkdirSync(globalDir(), { recursive: true });
  writeFileSync(globalConfigPath(), globalConfigTemplate(provider), 'utf8');
  log(`Created global config: ${globalConfigPath()}`);

  const envKey = PROVIDERS[provider].envKey;
  writeEnvKey(envKey, apiKey || '');
  log(`Stored ${envKey} in ${globalEnvPath()}`);

  const missing = missingRoles(provider);
  if (missing.length) {
    tag('warning').log(`No recommended ${missing.join(' and ')} for ${provider} — set the model ids in ${globalConfigPath()}`);
  }
  if (!apiKey && !process.env[envKey]) {
    tag('warning').log(`Add your API key to ${globalEnvPath()}`);
  }

  log('');
  log('Explorbot now runs from any directory:');
  tag('substep').log(chalk.yellow(`${getCliName()} explore https://your-app.example.com`));
  tag('substep').log(chalk.yellow(`${getCliName()} sites`));
}

export function runInitCommand(options: InitCommandOptions): void {
  const configPath = options.configPath ?? './explorbot.config.js';
  const force = options.force ?? false;
  const customPath = options.path;
  const originalCwd = process.cwd();

  if (customPath) {
    const dir = resolve(customPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      log(`Created directory: ${relativeToCwd(dir)}`);
    }
    process.chdir(dir);
    log(`Working in directory: ${relativeToCwd(dir)}`);
  }

  try {
    let outPath = resolve(configPath);
    if (existsSync(outPath) && statSync(outPath).isDirectory()) {
      outPath = join(outPath, 'explorbot.config.js');
    } else if (!extname(outPath)) {
      outPath = join(outPath, 'explorbot.config.js');
    }

    const dir = dirname(outPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      log(`Created directory: ${relativeToCwd(dir)}`);
    }

    if (existsSync(outPath) && !force) {
      log(`Config file already exists: ${relativeToCwd(outPath)}`);
      log('Use --force to overwrite existing file');
      process.exit(1);
    }

    writeFileSync(outPath, defaultConfigTemplate(), 'utf8');
    log(`Created config file: ${relativeToCwd(outPath)}`);

    const envPath = resolve(process.cwd(), '.env');
    if (!existsSync(envPath)) {
      writeFileSync(envPath, `${DEFAULT_ENV_TEMPLATE}\n`, 'utf8');
      log(`Created env file: ${relativeToCwd(envPath)}`);
    } else {
      log(`Env file already exists: ${relativeToCwd(envPath)}`);
    }

    log('');
    log('Next steps:');
    log('1. Configure AI provider in .env');
    log('2. Set AI models config file');
    log('3. Set web application URL in the config file');
    log('4. Add initial knowledge (how to authorize to the application, etc.)');
    tag('substep').log(chalk.yellow(`${getCliName()} learn * 'to aurhorize use these credentials: admin@example.com / secret123'`));
    tag('substep').log('You can use ${env.LOGIN} and ${env.PASSWORD} to reference environment variables.');

    log('5. Launch application on a relative URL');
    tag('substep').log(chalk.yellow(`${getCliName()} start /dashboard`));

    if (!existsSync('./output')) {
      mkdirSync('./output', { recursive: true });
      log('Created directory: output');
    }
  } catch (error) {
    log('Failed to create config file:', error);
    process.exit(1);
  } finally {
    if (process.cwd() !== originalCwd) {
      process.chdir(originalCwd);
    }
  }
}

async function runGlobalInit(options: InitCommandOptions): Promise<void> {
  const existing = findGlobalConfig();
  if (existing && !options.force) {
    log(`Global config already exists: ${existing}`);
    log('Use --force to overwrite existing file');
    process.exit(1);
  }

  if (options.provider) {
    writeGlobalConfig(options.provider, options.apiKey);
    return;
  }

  if (!process.stdin.isTTY) {
    log('Cannot run the setup wizard outside an interactive terminal');
    log(`Pass a provider instead: ${getCliName()} init --global --provider ${Object.keys(PROVIDERS)[0]}`);
    process.exit(1);
  }

  await renderInitWizard('global');
}

async function renderInitWizard(mode: 'choose' | 'global'): Promise<'local' | 'global' | null> {
  const [{ render }, React, InitWizard] = await Promise.all([import('ink'), import('react'), import('../components/InitWizard.js').then((m) => m.default)]);

  return new Promise((resolve) => {
    const finish = (choice: 'local' | 'global' | null) => {
      unmount();
      resolve(choice);
    };

    const { unmount } = render(
      React.createElement(InitWizard, {
        mode,
        globalConfigExists: !!findGlobalConfig(),
        onLocal: () => finish('local'),
        onComplete: () => finish('global'),
        onCancel: () => finish(null),
      }),
      { exitOnCtrlC: false, patchConsole: false }
    );
  });
}

function modelLines(provider: string): string {
  const recommended = ConfigParser.recommendedModels()[provider] || {};
  const roles: Array<[ModelRoleName, string]> = [
    ['model', 'fast model with tool calling capabilities'],
    ['visionModel', 'vision model for screenshot analysis'],
    ['agenticModel', 'agentic model for decision making'],
  ];

  return roles.map(([role, comment]) => `    // ${comment}\n    ${role}: '${provider}/${recommended[role] || '<model-id>'}',`).join('\n');
}

function globalConfigTemplate(provider: string): string {
  const { envKey } = PROVIDERS[provider];

  return `// Global Explorbot configuration — used by every directory without its own explorbot.config.js.
// Models are written as 'provider/model-id' so they resolve without a local node_modules.
// The key is read from ${envKey} in ~/.explorbot/.env
// Model ids are snapshotted from the recommendations of this Explorbot version.
// https://github.com/testomatio/explorbot/blob/main/docs/basics/providers.md
const config = {
  ai: {
${modelLines(provider)}
  },

  reporter: {
    // Save a local HTML report after each run.
    html: true,
    // Save a local markdown report after each run.
    markdown: true,
  },
};

export default config;
`;
}

function missingRoles(provider: string): string[] {
  const recommended = ConfigParser.recommendedModels()[provider] || {};
  return ['model', 'visionModel', 'agenticModel'].filter((role) => !recommended[role]);
}

function writeEnvKey(key: string, value: string): void {
  const envPath = globalEnvPath();
  let content = '# AI provider API keys';
  if (existsSync(envPath)) content = readFileSync(envPath, 'utf8').trimEnd();

  const lines = content.split('\n');
  const index = lines.findIndex((line) => line.startsWith(`${key}=`));

  if (index < 0) lines.push(`${key}=${value}`);
  if (index >= 0 && value) lines[index] = `${key}=${value}`;

  writeFileSync(envPath, `${lines.join('\n').trimEnd()}\n`, 'utf8');
}

type ModelRoleName = 'model' | 'visionModel' | 'agenticModel';

type InitCommandOptions = {
  configPath?: string;
  force?: boolean;
  path?: string;
  global?: boolean;
  provider?: string;
  apiKey?: string;
};
