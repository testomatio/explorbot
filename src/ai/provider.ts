import { type StreamTextResult, generateText, streamText } from 'ai';
import debug from 'debug';
import type { AIConfig } from '../../explorbot.config.ts';
import { log } from '../utils/logger.js';
import { setActivity, clearActivity } from '../activity.js';

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
    log('✅ AI provider initialized');
  }

  async chat(messages: any[], options: any = {}): Promise<any> {
    if (!this.provider) {
      await this.initialize();
    }

    setActivity(`AI request to ${this.config.model}`, 'ai');

    const config = {
      model: this.provider(this.config.model),
      ...this.config.config,
      ...options,
    };

    try {
      const response = await generateText({
        messages,
        ...config,
      });

      clearActivity();
      return response;
    } catch (error: any) {
      clearActivity();
      throw new AiError(error.message || error.toString());
    }
  }

  getProvider(): any {
    return this.provider;
  }
}

class AiError extends Error {}

export { AiError, Provider as AIProvider };
