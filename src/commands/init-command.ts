import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { log, tag } from '../utils/logger.js';
import dedent from 'dedent';
import chalk from 'chalk';
import { getCliName } from '../utils/cli-name.ts';

const DEFAULT_CONFIG_TEMPLATE = `import { createOpenRouter } from '@openrouter/ai-sdk-provider';
// import { '<your provider here>' } from '<your provider package here>';

// Vercel AI SDK is used to connect to AI providers.
// Bring your own provider or use OpenRouter (one API key, many providers).
// https://github.com/testomatio/explorbot/blob/main/docs/providers.md
const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

const config = {
  web: {
    // use application host without path prefix (e.g., http://localhost:3000)
    url: 'http://<your-app-host-here>',
  },

  ai: {
    // fast model with tool calling capabilities
    model: openrouter('<your base model here>'),
    // vision model for screenshot analysis
    visionModel: openrouter('<your vision model here>'),
    // agentic model for decision making
    agenticModel: openrouter('<your agentic model here>'),
  },
};

export default config;
`;

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

export function runInitCommand(options: InitCommandOptions): void {
  const configPath = options.configPath ?? './explorbot.config.js';
  const force = options.force ?? false;
  const customPath = options.path;
  const originalCwd = process.cwd();

  if (customPath) {
    const dir = resolve(customPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      log(`Created directory: ${dir}`);
    }
    process.chdir(dir);
    log(`Working in directory: ${dir}`);
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
      log(`Created directory: ${dir}`);
    }

    if (existsSync(outPath) && !force) {
      log(`Config file already exists: ${outPath}`);
      log('Use --force to overwrite existing file');
      process.exit(1);
    }

    writeFileSync(outPath, DEFAULT_CONFIG_TEMPLATE, 'utf8');
    log(`Created config file: ${outPath}`);

    const envPath = resolve(process.cwd(), '.env');
    if (!existsSync(envPath)) {
      writeFileSync(envPath, `${DEFAULT_ENV_TEMPLATE}\n`, 'utf8');
      log(`Created env file: ${envPath}`);
    } else {
      log(`Env file already exists: ${envPath}`);
    }

    log('');
    log('Next steps:');
    log('1. Configure AI provider in .env');
    log('2. Set AI models config file');
    log('3. Set web application URL in the config file');
    log('4. Add initial knowledge (how to authorize to the application, etc.)');
    tag('substep').log(chalk.yellow(`${getCliName()} learn * 'to aurhorize use these credentials: admin@example.com / secret123'`));
    tag('substep').log(`You can use \${env.LOGIN} and \${env.PASSWORD} to reference environment variables.`);

    log('5. Launch application on a relative URL');
    tag('substep').log(chalk.yellow(`${getCliName()} start /dashboard`));

    if (!existsSync('./output')) {
      mkdirSync('./output', { recursive: true });
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
}

type InitCommandOptions = {
  configPath?: string;
  force?: boolean;
  path?: string;
};
