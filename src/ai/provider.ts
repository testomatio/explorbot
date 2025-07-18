import { type StreamTextResult, generateText, streamText } from 'ai';
import debug from 'debug';
import type { AIConfig } from '../../explorbot.config.ts';

const debugLog = debug('explorbot:ai');

export class Provider {
  private config: AIConfig;
  private provider: any = null;

  constructor(config: AIConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    if (!this.config.provider) {
      throw new Error(
        'AI provider not set in config. Please import and set the provider.'
      );
    }

    this.provider = this.config.provider;
    console.log('✅ AI provider initialized');
  }

  async chat(messages: any[], options: any = {}): Promise<any> {
    if (!this.provider) {
      await this.initialize();
    }

    const config = {
      model: this.provider(this.config.model),
      ...this.config.config,
      ...options,
    };

    const response = await generateText({
      messages,
      ...config,
    });

    return response;
  }

  getProvider(): any {
    return this.provider;
  }
}

export { Provider as AIProvider };
