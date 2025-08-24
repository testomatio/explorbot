import { type StreamTextResult, generateText, streamText } from 'ai';
import type { AIConfig } from '../../explorbot.config.ts';
import { log, createDebug, setVerboseMode } from '../utils/logger.js';
import { setActivity, clearActivity } from '../activity.js';

const debugLog = createDebug('explorbot:ai');

export class Provider {
  private config: AIConfig;
  private provider: any = null;

  constructor(config: AIConfig) {
    this.config = config;
    this.provider = this.config.provider;
  }

  async chat(messages: any[], options: any = {}): Promise<any> {
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
      debugLog('AI response:', response.text);
      return response;
    } catch (error: any) {
      clearActivity();
      throw new AiError(error.message || error.toString());
    }
  }

  getProvider(): any {
    return this.provider;
  }

  setVerboseMode(enabled: boolean): void {
    if (enabled) {
      process.env.DEBUG = process.env.DEBUG ? `${process.env.DEBUG},explorbot:ai:*` : 'explorbot:ai:*';
    }
  }
}

class AiError extends Error {}

export { AiError, Provider as AIProvider };
