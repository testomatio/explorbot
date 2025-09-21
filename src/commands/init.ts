import fs from 'node:fs';
import path from 'node:path';
import { log } from '../utils/logger.js';

export interface InitOptions {
  configPath?: string;
  force?: boolean;
  path?: string;
}

export async function initCommand(options: InitOptions = {}): Promise<void> {
  const configPath = options.configPath || './explorbot.config.js';
  const force = options.force || false;
  const customPath = options.path;

  // Store original working directory
  const originalCwd = process.cwd();

  // If custom path is provided, change to that directory
  if (customPath) {
    const resolvedPath = path.resolve(customPath);

    // Create the directory if it doesn't exist
    if (!fs.existsSync(resolvedPath)) {
      fs.mkdirSync(resolvedPath, { recursive: true });
      log(`Created directory: ${resolvedPath}`);
    }

    process.chdir(resolvedPath);
    log(`Working in directory: ${resolvedPath}`);
  }

  function getDefaultConfig(): string {
    return `import { openai } from 'ai';

const config = {
  playwright: {
    browser: 'chromium',
    url: 'http://localhost:3000',
    windowSize: '1200x900',
  },

  ai: {
    provider: openai,
    model: 'gpt-4o',
    apiKey: process.env.OPENAI_API_KEY || '',
  },
};

export default config;
`;
  }

  function createOutputDirectories(): void {
    const dirs = ['./output'];

    dirs.forEach((dir) => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        log(`Created directory: ${dir}`);
      }
    });
  }

  function resolveConfigPath(configPath: string): string {
    const absolutePath = path.resolve(configPath);

    if (
      fs.existsSync(absolutePath) &&
      fs.statSync(absolutePath).isDirectory()
    ) {
      return path.join(absolutePath, 'explorbot.config.js');
    }

    const ext = path.extname(absolutePath);
    if (!ext) {
      return path.join(absolutePath, 'explorbot.config.js');
    }

    return absolutePath;
  }

  try {
    const resolvedPath = resolveConfigPath(configPath);
    const dir = path.dirname(resolvedPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      log(`Created directory: ${dir}`);
    }

    if (fs.existsSync(resolvedPath) && !force) {
      log(`Config file already exists: ${resolvedPath}`);
      log('Use --force to overwrite existing file');
      process.exit(1);
    }

    const configContent = getDefaultConfig();
    fs.writeFileSync(resolvedPath, configContent, 'utf8');

    log(`Created config file: ${resolvedPath}`);
    log('');
    log('Next steps:');
    log('1. Set your API key in the config file or as environment variable');
    log('2. Customize the configuration as needed');
    log('3. Run: explorbot start');
    log('');
    log('You can also use different AI providers:');
    log('   - import { anthropic } from "ai" for Claude');
    log('   - import { bedrock } from "ai" for AWS Bedrock');
    log('   - Or any other provider that supports the chat interface');

    createOutputDirectories();
  } catch (error) {
    log('Failed to create config file:', error);
    process.exit(1);
  } finally {
    // Always restore original working directory
    if (process.cwd() !== originalCwd) {
      process.chdir(originalCwd);
    }
  }
}
