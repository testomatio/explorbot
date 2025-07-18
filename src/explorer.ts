import path from 'node:path';
import * as codeceptjs from 'codeceptjs';
import type { ExplorbotConfig } from '../explorbot.config.js';
import Action from './action.js';
import { PromptVocabulary } from './ai/prompt.js';
import { AIProvider } from './ai/provider.js';
import { ConfigParser } from './config.js';
import { ExperienceTracker } from './experience-tracker.js';
import { PromptParser } from './prompt-parser.js';

class Explorer {
  private config: ExplorbotConfig | null = null;
  private configParser: ConfigParser;
  private aiProvider: AIProvider | null = null;
  private promptParser: PromptParser;
  private promptVocabulary: PromptVocabulary | null = null;
  private experienceTracker: ExperienceTracker | null = null;
  playwrightHelper: any;
  private isStarted = false;
  actor: CodeceptJS.I;

  constructor(configPath?: string) {
    this.configParser = ConfigParser.getInstance();
    this.promptParser = new PromptParser();
  }

  private async initializeContainer(configPath?: string): Promise<void> {
    try {
      this.config = await this.configParser.loadConfig(configPath);

      (global as unknown as NodeJS.Global).output_dir = path.join(
        process.cwd(),
        'output'
      );

      this.configParser.validateConfig(this.config);

      const codeceptConfig = this.convertToCodeceptConfig(this.config);

      codeceptjs.container.create(codeceptConfig, {});

      console.log(
        `✅ Container initialized with ${this.config.playwright.browser} browser`
      );
    } catch (error) {
      console.error('❌ Failed to initialize container:', error);
      throw error;
    }
  }

  private async loadPrompts(): Promise<void> {
    const configPath = this.configParser.getConfigPath();
    if (!configPath) {
      console.warn('⚠️ No config path found, skipping prompt loading');
      return;
    }

    const configDir = path.dirname(configPath);
    const knowledgeDir = path.join(
      configDir,
      this.config?.dirs?.knowledge || 'knowledge'
    );
    await this.promptParser.loadPromptsFromDirectory(knowledgeDir);
    const experienceDir = path.join(
      configDir,
      this.config?.dirs?.experience || 'experience'
    );
    await this.promptParser.loadPromptsFromDirectory(experienceDir);
  }

  private async initializeAI(): Promise<void> {
    if (!this.config) {
      throw new Error('Configuration not loaded. Call run() first.');
    }

    await this.loadPrompts();

    if (!this.aiProvider) {
      this.aiProvider = new AIProvider(this.config.ai);
      await this.aiProvider.initialize();
    }
    this.promptVocabulary = new PromptVocabulary(
      this.aiProvider,
      this.promptParser
    );

    // Initialize experience tracker
    const configPath = this.configParser.getConfigPath();
    if (configPath) {
      const configDir = path.dirname(configPath);
      const experienceDir = path.join(
        configDir,
        this.config?.dirs?.experience || 'experience'
      );
      this.experienceTracker = new ExperienceTracker(experienceDir);
    }
  }

  private convertToCodeceptConfig(config: ExplorbotConfig): any {
    const playwrightConfig = { ...config.playwright };
    
    if (config.playwright.browser === 'chromium' && config.playwright.headless) {
      const debugPort = 9222;
      playwrightConfig.args = [
        ...(config.playwright.args || []),
        `--remote-debugging-port=${debugPort}`,
        '--remote-debugging-address=0.0.0.0',
      ];
      
      console.log(`🔧 Chrome started with remote debugging on port ${debugPort}`);
      console.log(`🌐 To access the headless browser from regular Chrome:`);
      console.log(`   1. Open Chrome browser`);
      console.log(`   2. Navigate to: chrome://inspect/#devices`);
      console.log(`   3. Click "Configure..." and add: localhost:${debugPort}`);
      console.log(`   4. Click "inspect" on the discovered target`);
      console.log(`   5. Or directly visit: http://localhost:${debugPort}`);
    }
    
    return {
      helpers: {
        Playwright: {
          ...playwrightConfig,
        },
      },
    };
  }

  public getConfig(): ExplorbotConfig {
    if (!this.config) {
      throw new Error('Configuration not loaded. Call run() first.');
    }
    return this.config;
  }

  public getConfigPath(): string | null {
    return this.configParser.getConfigPath();
  }

  public getAIProvider(): AIProvider | null {
    return this.aiProvider;
  }

  public getAllPrompts() {
    return this.promptParser.getAllPrompts();
  }

  public getPromptUrls(): string[] {
    return this.promptParser.getPromptUrls();
  }

  async start(configPath?: string) {
    if (!this.config) {
      await this.initializeContainer(configPath);
    }

    await codeceptjs.recorder.start();
    await codeceptjs.container.started(null);

    this.playwrightHelper = codeceptjs.container.helpers('Playwright');
    await this.playwrightHelper._startBrowser();
    await this.playwrightHelper._createContextPage();
    await this.initializeAI();
    const I = codeceptjs.container.support('I');

    this.actor = I;
    this.isStarted = true;
    return I;
  }

  createAction() {
    return new Action(
      this.actor,
      this.promptVocabulary || undefined,
      this.experienceTracker || undefined
    );
  }

  async stop(): Promise<void> {
    if (!this.isStarted) {
      return;
    }

    await this.playwrightHelper._stopBrowser();
    await codeceptjs.recorder.stop();
  }
}

export default Explorer;
