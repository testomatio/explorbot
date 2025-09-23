import { generateText, generateObject } from 'ai';
import type { AIConfig } from '../config.js';
import { createDebug, tag } from '../utils/logger.js';
import { setActivity, clearActivity } from '../activity.ts';
import { Conversation, type Message } from './conversation.js';
import { withRetry, type RetryOptions } from '../utils/retry.js';

const debugLog = createDebug('explorbot:ai');

export class Provider {
  private config: AIConfig;
  private provider: any = null;
  private defaultRetryOptions: RetryOptions = {
    maxAttempts: 3,
    baseDelay: 10,
    maxDelay: 10000,
    retryCondition: (error: Error) => {
      return (
        error.name === 'AI_APICallError' ||
        error.message.includes('timeout') ||
        error.message.includes('network') ||
        error.message.includes('rate limit') ||
        error.message.includes('AI request timeout')
      );
    },
  };

  constructor(config: AIConfig) {
    this.config = config;
    this.provider = this.config.provider;
  }

  private getRetryOptions(options: any = {}): RetryOptions {
    return {
      ...this.defaultRetryOptions,
      maxAttempts: options.maxRetries || this.defaultRetryOptions.maxAttempts,
    };
  }

  startConversation(systemMessage: string) {
    return new Conversation([
      {
        role: 'system',
        content: [{ type: 'text', text: systemMessage }],
      },
    ]);
  }

  async invokeConversation(
    conversation: Conversation,
    tools?: any
  ): Promise<{ conversation: Conversation; response: any } | null> {
    const response = tools
      ? await this.generateWithTools(conversation.messages, tools)
      : await this.chat(conversation.messages);
    conversation.addAssistantText(response.text);
    return { conversation, response };
  }

  async chat(messages: any[], options: any = {}): Promise<any> {
    setActivity(`🤖 Asking ${this.config.model}`, 'ai');

    debugLog('AI config:', this.config);
    debugLog('AI options:', options);

    messages = this.filterImages(messages);

    const config = {
      ...this.config,
      ...options,
      model: this.provider(this.config.model),
    };

    try {
      const response = await withRetry(async () => {
        const result = await generateText({ messages, ...config });
        if (!result.text) {
          debugLog(result);
          throw new Error('No response text from AI');
        }
        return result;
      }, this.getRetryOptions(options));

      clearActivity();
      debugLog('AI response:', response.text);
      return response;
    } catch (error: any) {
      tag('error').log(error.message || error.toString());
      clearActivity();
      throw new AiError(error.message || error.toString());
    }
  }

  async generateWithTools(
    messages: any[],
    tools: any,
    options: any = {}
  ): Promise<any> {
    setActivity(`🤖 Asking ${this.config.model} with dynamic tools`, 'ai');

    messages = this.filterImages(messages);

    const toolNames = Object.keys(tools || {});
    tag('debug').log(`Tools enabled: [${toolNames.join(', ')}]`);
    debugLog('Available tools:', toolNames);

    const config = {
      model: this.provider(this.config.model),
      tools,
      maxToolRoundtrips: options.maxToolRoundtrips || 5,
      toolChoice: 'auto',
      ...this.config.config,
      ...options,
    };

    try {
      const response = await withRetry(async () => {
        const timeout = config.timeout || 30000;
        return (await Promise.race([
          generateText({
            messages,
            ...config,
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('AI request timeout')), timeout)
          ),
        ])) as any;
      }, this.getRetryOptions(options));

      clearActivity();

      // Log tool usage summary
      if (response.toolCalls && response.toolCalls.length > 0) {
        tag('debug').log(`AI executed ${response.toolCalls.length} tool calls`);
        response.toolCalls.forEach((call: any, index: number) => {
          tag('step').log(
            `⯈ ${call.toolName}(${Object.values(call?.input || []).join(', ')})`
          );
        });
      }

      return response;
    } catch (error: any) {
      console.log(error.messages);
      console.log(error.tools);
      clearActivity();
      throw error;
    }
  }

  async generateObject(
    messages: any[],
    schema: any,
    options: any = {}
  ): Promise<any> {
    setActivity(`🤖 Asking ${this.config.model} for structured output`, 'ai');

    messages = this.filterImages(messages);

    const config = {
      model: this.provider(this.config.model),
      schema,
      ...this.config.config,
      ...options,
    };

    try {
      const response = await withRetry(async () => {
        const timeout = config.timeout || 30000;
        return (await Promise.race([
          generateObject({
            messages,
            ...config,
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('AI request timeout')), timeout)
          ),
        ])) as any;
      }, this.getRetryOptions(options));

      clearActivity();
      debugLog('AI structured response:', response.object);
      tag('info').log('🎯 AI structured response received');
      return response;
    } catch (error: any) {
      clearActivity();
      throw new AiError(error.message || error.toString());
    }
  }

  getProvider(): any {
    return this.provider;
  }

  filterImages(messages: any[]): any[] {
    if (this.config.vision) {
      return messages;
    }

    messages.forEach((message) => {
      if (!Array.isArray(message.content)) return;
      message.content = message.content.filter((content: any) => {
        if (content.type === 'image') return false;
        return true;
      });
    });

    return messages;
  }
}

class AiError extends Error {}

export { AiError, Provider as AIProvider };
