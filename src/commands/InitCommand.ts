import fs from 'node:fs';
import path from 'node:path';
import { log } from '../utils/logger.js';

export class InitCommand {
  private getDefaultConfig(): string {
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

  private createOutputDirectories(): void {
    const dirs = ['./output'];

    dirs.forEach((dir) => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        log(`✅ Created directory: ${dir}`);
      }
    });
  }

  private resolveConfigPath(configPath: string): string {
    const absolutePath = path.resolve(configPath);

    // Check if the path is a directory
    if (
      fs.existsSync(absolutePath) &&
      fs.statSync(absolutePath).isDirectory()
    ) {
      // If it's a directory, append the default filename
      return path.join(absolutePath, 'explorbot.config.js');
    }

    // Check if the path doesn't have a file extension
    const ext = path.extname(absolutePath);
    if (!ext) {
      // If no extension, assume it's a directory and append filename
      return path.join(absolutePath, 'explorbot.config.js');
    }

    return absolutePath;
  }

  run(configPath: string, force = false): void {
    try {
      const resolvedPath = this.resolveConfigPath(configPath);
      const dir = path.dirname(resolvedPath);

      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        log(`✅ Created directory: ${dir}`);
      }

      if (fs.existsSync(resolvedPath) && !force) {
        log(`❌ Config file already exists: ${resolvedPath}`);
        log('Use --force to overwrite existing file');
        process.exit(1);
      }

      const configContent = this.getDefaultConfig();
      fs.writeFileSync(resolvedPath, configContent, 'utf8');

      log(`✅ Created config file: ${resolvedPath}`);
      log('');
      log('📝 Next steps:');
      log('1. Set your API key in the config file or as environment variable');
      log('2. Customize the configuration as needed');
      log('3. Run: explorbot start');
      log('');
      log('💡 You can also use different AI providers:');
      log('   - import { anthropic } from "ai" for Claude');
      log('   - import { bedrock } from "ai" for AWS Bedrock');
      log('   - Or any other provider that supports the chat interface');

      this.createOutputDirectories();
    } catch (error) {
      log('❌ Failed to create config file:', error);
      process.exit(1);
    }
  }
}
