import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import chalk from 'chalk';
import figureSet from 'figures';
import { ConfigParser, type ModelRole, PROVIDERS, missingModelRoles } from '../config.ts';
import { findGlobalConfig, globalConfigPath, globalDir, globalEnvPath } from '../global-config.ts';
import { getCliName } from '../utils/cli-name.ts';
import { log, tag } from '../utils/logger.js';
import { type NextStepCommand, type NextStepSection, printNextSteps, relativeToCwd } from '../utils/next-steps.ts';

function defaultConfigTemplate(provider: string, url?: string): string {
  const appUrl = url || 'http://<your-app-host-here>';
  return `// 'provider/model-id' uses a bundled provider.
// It is also possible to import provider as a module from Vercel AI SDK.
// https://testomat.ai/docs/explorbot

const config = {
  web: {
    // use application host without path prefix (e.g., http://localhost:3000)
    url: '${appUrl}',
  },

  ai: {
    // every role (model, visionModel, agenticModel) takes the recommended ${provider} models bundled with this version
    // override a single role as 'provider/model-id':
    // model: '${provider}/<model-id>',
    recommendedModels: '${provider}',
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

export function envTemplate(provider: string): string {
  const keyLines = Object.entries(PROVIDERS).map(([name, { envKey }]) => {
    if (name === provider) return `${envKey}=`;
    return `# ${envKey}=`;
  });

  return `# AI provider API keys
${keyLines.join('\n')}

# Langfuse Tracing
LANGFUSE_SECRET_KEY=
LANGFUSE_PUBLIC_KEY=
LANGFUSE_BASE_URL=

# Testomat.io API key to publish run results
TESTOMATIO=`;
}

export async function runInit(options: InitCommandOptions): Promise<void> {
  const localRequested = !!(options.configPath || options.path);
  if (options.global || (options.provider && !localRequested)) {
    await runGlobalInit(options);
    return;
  }

  if (options.configPath || options.path || !process.stdin.isTTY) {
    runInitCommand(options);
    return;
  }

  const choice = await renderInitWizard('choose');
  if (choice !== 'local') return;

  const setup = await renderLocalSetupWizard();
  if (!setup) return;

  runInitCommand({ ...options, ...setup });
}

export function writeGlobalConfig(provider: string, apiKey?: string): void {
  if (!PROVIDERS[provider]) {
    throw new Error(`Unknown AI provider "${provider}". Supported providers: ${Object.keys(PROVIDERS).join(', ')}`);
  }

  mkdirSync(globalDir(), { recursive: true });
  writeFileSync(globalConfigPath(), globalConfigTemplate(provider), 'utf8');
  tag('success').log(`${figureSet.tick} Created global config: ${globalConfigPath()}`);

  const envKey = PROVIDERS[provider].envKey;
  writeEnvKey(envKey, apiKey || '');
  tag('success').log(`${figureSet.tick} Stored ${envKey} in ${globalEnvPath()}`);

  const missing = missingModelRoles(provider);
  if (missing.length) {
    tag('warning').log(`No recommended ${missing.join(' and ')} for ${provider} — set the model ids in ${globalConfigPath()}`);
  }
  if (!apiKey && !process.env[envKey]) {
    tag('warning').log(`Add your API key to ${globalEnvPath()}`);
  }

  log('');
  log(`${figureSet.star} What's next:`);
  printInitNextSteps({
    siteCommands: [
      { label: 'Any site', command: `${getCliName()} explore https://your-app.example.com` },
      { label: 'Saved sites', command: `${getCliName()} sites` },
    ],
  });
}

export function runInitCommand(options: InitCommandOptions): void {
  const provider = options.provider || 'openrouter';
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

  const configName = 'explorbot.config.js';
  const configPath = options.configPath ?? `./${configName}`;

  try {
    let outPath = resolve(configPath);
    if (existsSync(outPath) && statSync(outPath).isDirectory()) {
      outPath = join(outPath, configName);
    } else if (!extname(outPath)) {
      outPath = join(outPath, configName);
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

    writeFileSync(outPath, defaultConfigTemplate(provider, options.url), 'utf8');
    tag('success').log(`${figureSet.tick} Created config file: ${relativeToCwd(outPath)}`);

    const envPath = resolve(process.cwd(), '.env');
    if (!existsSync(envPath)) {
      writeFileSync(envPath, `${envTemplate(provider)}\n`, 'utf8');
      tag('success').log(`${figureSet.tick} Created env file: ${relativeToCwd(envPath)}`);
    } else {
      log(`Env file already exists: ${relativeToCwd(envPath)}`);
    }

    const envKey = PROVIDERS[provider].envKey;
    if (options.apiKey) {
      writeEnvKey(envKey, options.apiKey, envPath);
      tag('success').log(`${figureSet.tick} Stored ${envKey} in ${relativeToCwd(envPath)}`);
    }
    if (!options.apiKey && !process.env[envKey]) {
      tag('warning').log(`Add your API key to ${envKey}= in ${relativeToCwd(envPath)}`);
    }
    if (!options.url) {
      tag('warning').log(`Set your application URL in web.url: ${relativeToCwd(outPath)}`);
    }

    const missing = missingModelRoles(provider);
    if (missing.length) {
      tag('warning').log(`No recommended ${missing.join(' and ')} for ${provider} — set the model ids in ${relativeToCwd(outPath)}`);
    }

    if (!existsSync('./output')) {
      mkdirSync('./output', { recursive: true });
      tag('success').log(`${figureSet.tick} Created directory: output`);
    }

    log('');
    log(`${figureSet.star} What's next:`);
    printInitNextSteps({ url: options.url });
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

async function renderLocalSetupWizard(): Promise<LocalSetup | null> {
  const [{ render }, React, InitWizard] = await Promise.all([import('ink'), import('react'), import('../components/InitWizard.js').then((m) => m.default)]);

  return new Promise((resolve) => {
    const finish = (setup: LocalSetup | null) => {
      unmount();
      resolve(setup);
    };
    const { unmount } = render(
      React.createElement(InitWizard, {
        mode: 'local',
        globalConfigExists: !!findGlobalConfig(),
        onLocal: () => finish(null),
        onComplete: () => finish(null),
        onCancel: () => finish(null),
        onLocalSetup: (setup) => finish(setup),
      }),
      { exitOnCtrlC: false, patchConsole: false }
    );
  });
}

export function modelLines(provider: string, only?: ModelRole[]): string {
  const recommended = ConfigParser.recommendedModels()[provider] || {};
  const roles: Array<[ModelRole, string]> = [
    ['model', 'fast model with tool calling capabilities'],
    ['visionModel', 'vision model for screenshot analysis'],
    ['agenticModel', 'agentic model for decision making'],
  ];

  let selected = roles;
  if (only) selected = roles.filter(([role]) => only.includes(role));

  const lines = selected.map(([role, comment]) => `    // ${comment}\n    ${role}: '${provider}/${recommended[role] || '<model-id>'}',`);
  if (!only && recommended.decisionModel) lines.push(`    // decision model judging ambiguous outcomes\n    decisionModel: { provider: '${provider}', model: '${recommended.decisionModel}' },`);
  return lines.join('\n');
}

function globalConfigTemplate(provider: string): string {
  const { envKey } = PROVIDERS[provider];

  return `// Global Explorbot configuration — used by every directory without its own explorbot.config.js.
// Settings shared by every site. Each site extends them in
// ~/.explorbot/sites/<host>/explorbot.config.js, written on its first run.
// Models are written as 'provider/model-id' so they resolve without a local node_modules.
// The key is read from ${envKey} in ~/.explorbot/.env
// Model ids are snapshotted from the recommendations of this Explorbot version.
// https://testomat.ai/docs/explorbot
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

function printInitNextSteps(options: { url?: string; siteCommands?: NextStepCommand[] }): void {
  const cli = getCliName();
  const sections: NextStepSection[] = [
    {
      label: 'Try the demo on a sample app',
      commands: [{ command: `${cli} explore https://todomvc.com/examples/react/dist/` }],
    },
  ];

  if (options.url) {
    sections.push({
      label: 'Explore your app',
      commands: [
        { label: 'Whole site', command: `${cli} explore ${options.url}` },
        { label: 'One page', command: `${cli} explore /dashboard` },
      ],
    });
  }

  if (options.siteCommands) sections.push({ label: 'Explore any site', commands: options.siteCommands });

  sections.push(
    {
      label: 'Run it from VS Code',
      commands: [{ command: 'https://testomat.ai/explorbot' }],
    },
    {
      label: 'Docs',
      commands: [{ command: 'https://testomat.ai/docs/explorbot' }],
    }
  );

  printNextSteps(sections);

  log('');
  log('Add knowledge (logins, credentials) — created on first use in ./knowledge:');
  tag('substep').log(chalk.yellow(`${cli} learn '*' 'to authorize use these credentials: admin@example.com / secret123'`));
  tag('substep').log('You can use ${env.LOGIN} and ${env.PASSWORD} to reference environment variables.');
}

function writeEnvKey(key: string, value: string, envPath = globalEnvPath()): void {
  let content = '# AI provider API keys';
  if (existsSync(envPath)) content = readFileSync(envPath, 'utf8').trimEnd();

  const lines = content.split('\n');
  const index = lines.findIndex((line) => line.startsWith(`${key}=`));

  if (index < 0) lines.push(`${key}=${value}`);
  if (index >= 0 && value) lines[index] = `${key}=${value}`;

  writeFileSync(envPath, `${lines.join('\n').trimEnd()}\n`, 'utf8');
}

type LocalSetup = {
  provider: string;
  apiKey: string;
  url: string;
};

type InitCommandOptions = {
  configPath?: string;
  force?: boolean;
  path?: string;
  global?: boolean;
  provider?: string;
  apiKey?: string;
  url?: string;
};
