import fs from 'node:fs';
import path from 'node:path';

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
        console.log(`✅ Created directory: ${dir}`);
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
        console.log(`✅ Created directory: ${dir}`);
      }

      if (fs.existsSync(resolvedPath) && !force) {
        console.error(`❌ Config file already exists: ${resolvedPath}`);
        console.log('Use --force to overwrite existing file');
        process.exit(1);
      }

      const configContent = this.getDefaultConfig();
      fs.writeFileSync(resolvedPath, configContent, 'utf8');

      console.log(`✅ Created config file: ${resolvedPath}`);
      console.log('');
      console.log('📝 Next steps:');
      console.log(
        '1. Set your API key in the config file or as environment variable'
      );
      console.log('2. Customize the configuration as needed');
      console.log('3. Run: explorbot start');
      console.log('');
      console.log('💡 You can also use different AI providers:');
      console.log('   - import { anthropic } from "ai" for Claude');
      console.log('   - import { bedrock } from "ai" for AWS Bedrock');
      console.log(
        '   - Or any other provider that supports the chat interface'
      );

      this.createOutputDirectories();
    } catch (error) {
      console.error('❌ Failed to create config file:', error);
      process.exit(1);
    }
  }
}
