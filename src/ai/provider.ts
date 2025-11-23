import { generateObject, generateText } from 'ai';
import type { ModelMessage } from 'ai';
import { readFileSync } from 'node:fs';
import { clearActivity, setActivity } from '../activity.ts';
import type { AIConfig } from '../config.js';
import { createDebug, tag } from '../utils/logger.js';
import { type RetryOptions, withRetry } from '../utils/retry.js';
import { Conversation } from './conversation.js';

const debugLog = createDebug('explorbot:provider');
const promptLog = createDebug('explorbot:provider:out');
const responseLog = createDebug('explorbot:provider:in');

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
  lastConversation: Conversation | null = null;

  constructor(config: AIConfig) {
    this.config = config;
    this.provider = this.config.provider;
  }

  getModelForAgent(agentName?: string): string {
    if (!agentName) {
      return this.config.model;
    }

    const agentConfig = this.config.agents?.[agentName as keyof typeof this.config.agents];
    return agentConfig?.model || this.config.model;
  }

  private getRetryOptions(options: any = {}): RetryOptions {
    return {
      ...this.defaultRetryOptions,
      maxAttempts: options.maxRetries || this.defaultRetryOptions.maxAttempts,
    };
  }

  startConversation(systemMessage: string, agentName?: string) {
    const model = this.getModelForAgent(agentName);
    return new Conversation(
      [
        {
          role: 'system',
          content: systemMessage,
        },
      ],
      model
    );
  }

  async invokeConversation(conversation: Conversation, tools?: any, options: any = {}): Promise<{ conversation: Conversation; response: any; toolExecutions?: any[] } | null> {
    const response = tools ? await this.generateWithTools(conversation.messages, conversation.model, tools, options) : await this.chat(conversation.messages, conversation.model, options);
    conversation.addAssistantText(response.text);
    this.lastConversation = conversation;

    const toolCalls = response.toolCalls || [];
    const toolResults = response.toolResults || [];

    const toolExecutions = toolCalls.map((call: any, index: number) => ({
      toolName: call.toolName || '',
      input: call.input,
      output: toolResults[index]?.output,
      wasSuccessful: toolResults[index]?.output?.success || false,
    }));

    return { conversation, response, toolExecutions };
  }

  async chat(messages: ModelMessage[], model: string, options: any = {}): Promise<any> {
    setActivity(`🤖 Asking ${model}`, 'ai');
    promptLog(`Using model: ${model}`);

    const config = {
      ...this.config,
      ...options,
      model: this.provider(model),
    };

    promptLog(messages[messages.length - 1].content);
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
      responseLog(response.text);
      return response;
    } catch (error: any) {
      tag('error').log(error.message || error.toString());
      clearActivity();
      throw new AiError(error.message || error.toString());
    }
  }

  async generateWithTools(messages: ModelMessage[], model: string, tools: any, options: any = {}): Promise<any> {
    setActivity(`🤖 Asking ${model} with dynamic tools`, 'ai');
    promptLog(`Using model: ${model}`);

    const toolNames = Object.keys(tools || {});
    tag('debug').log(`Tools enabled: [${toolNames.join(', ')}]`);
    promptLog('Available tools:', toolNames);
    promptLog(messages[messages.length - 1].content);

    const config = {
      model: this.provider(model),
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
          new Promise((_, reject) => setTimeout(() => reject(new Error('AI request timeout')), timeout)),
        ])) as any;
      }, this.getRetryOptions(options));

      clearActivity();

      // Log tool usage summary
      if (response.toolCalls && response.toolCalls.length > 0) {
        tag('debug').log(`AI executed ${response.toolCalls.length} tool calls`);
        responseLog(response.toolCalls);
        response.toolCalls.forEach((call: any, index: number) => {
          tag('step').log(`${call.toolName}(${Object.values(call?.input || []).join(', ')})`);
        });
      }

      responseLog(response.text);

      return response;
    } catch (error: any) {
      console.log(error.messages);
      console.log(error.tools);
      clearActivity();
      throw error;
    }
  }

  async generateObject(messages: ModelMessage[], schema: any, model?: string, options: any = {}): Promise<any> {
    const modelToUse = model || this.config.model;
    setActivity(`🤖 Asking ${modelToUse} for structured output`, 'ai');
    promptLog(`Using model: ${modelToUse}`);

    const config = {
      model: this.provider(modelToUse),
      schema,
      ...this.config.config,
      ...options,
    };

    try {
      promptLog(messages[messages.length - 1].content);
      const response = await withRetry(async () => {
        const timeout = config.timeout || 30000;
        return (await Promise.race([
          generateObject({
            messages,
            ...config,
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('AI request timeout')), timeout)),
        ])) as any;
      }, this.getRetryOptions(options));

      clearActivity();
      responseLog(response.object);

      return response;
    } catch (error: any) {
      clearActivity();
      throw new AiError(error.message || error.toString());
    }
  }

  getProvider(): any {
    return this.provider;
  }

  async processImage(prompt: string, image: string): Promise<any> {
    if (!this.config.visionModel) {
      throw new Error('Vision model not configured. Please set ai.visionModel in your config.');
    }

    setActivity(`🤖 Processing image with ${this.config.visionModel}`, 'ai');

    const imageData = `data:image/png;base64,${image.toString()}`;

    const messages: ModelMessage[] = [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: prompt,
          },
          {
            type: 'image',
            image: imageData,
          },
        ],
      },
    ];

    const config = {
      model: this.provider(this.config.visionModel),
      ...this.config.config,
    };

    try {
      promptLog(`Processing image with prompt: ${prompt}`);
      const response = await withRetry(async () => {
        return await generateText({
          messages,
          ...config,
        });
      }, this.getRetryOptions());

      clearActivity();
      responseLog(response.text);
      return response;
    } catch (error: any) {
      clearActivity();
      throw new AiError(error.message || error.toString());
    }
  }

  hasVision(): boolean {
    return this.config.visionModel !== undefined;
  }
}

class AiError extends Error {}

export { AiError, Provider as AIProvider };
