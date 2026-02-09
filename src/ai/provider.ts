import { LangfuseSpanProcessor } from '@langfuse/otel';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { generateObject, generateText } from 'ai';
import type { ModelMessage } from 'ai';
import { clearActivity, setActivity } from '../activity.ts';
import type { AIConfig } from '../config.js';
import { Observability } from '../observability.ts';
import { Stats } from '../stats.ts';
import { createDebug, tag } from '../utils/logger.js';
import { type RetryOptions, withRetry } from '../utils/retry.js';
import { Conversation } from './conversation.js';

const debugLog = createDebug('explorbot:provider');
const promptLog = createDebug('explorbot:provider:out');
const responseLog = createDebug('explorbot:provider:in');

class AiError extends Error {}

export class Provider {
  private config: AIConfig;
  private provider: any = null;
  private telemetryEnabled = false;
  private otelSdk: NodeSDK | null = null;
  private defaultRetryOptions: RetryOptions = {
    maxAttempts: 3,
    baseDelay: 10,
    maxDelay: 10000,
    retryCondition: (error: Error) => {
      return error.name === 'AI_APICallError' || error.message.includes('timeout') || error.message.includes('network') || error.message.includes('rate limit') || error.message.includes('AI request timeout') || error.message.includes('schema') || error.message.includes('No object generated');
    },
  };
  lastConversation: Conversation | null = null;

  constructor(config: AIConfig) {
    if (!config?.provider) {
      throw new AiError('AI provider is not configured. Set ai.provider in your config file.');
    }
    if (typeof config.provider !== 'function') {
      throw new AiError('AI provider must be a function (e.g., from @ai-sdk/openai, @ai-sdk/anthropic).');
    }
    if (!config?.model) {
      throw new AiError('AI model is not configured. Set ai.model in your config file.');
    }
    this.config = config;
    this.provider = this.config.provider;
    this.initLangfuse();
  }

  async validateConnection(): Promise<void> {
    try {
      await generateText({
        model: this.provider(this.config.model),
        prompt: 'hi',
        maxTokens: 1,
      });
    } catch (error: any) {
      throw new AiError(`AI connection failed: ${error.message}`);
    }
  }

  getModelForAgent(agentName?: string): string {
    if (!agentName) {
      return this.config.model;
    }

    const agentConfig = this.config.agents?.[agentName as keyof typeof this.config.agents];
    return agentConfig?.model || this.config.model;
  }

  getSystemPromptForAgent(agentName: string): string | undefined {
    const agentConfig = this.config.agents?.[agentName as keyof typeof this.config.agents];
    return agentConfig?.systemPrompt;
  }

  private getRetryOptions(options: any = {}): RetryOptions {
    return {
      ...this.defaultRetryOptions,
      maxAttempts: options.maxRetries || this.defaultRetryOptions.maxAttempts,
    };
  }

  private initLangfuse() {
    const langfuseConfig = this.config.langfuse;
    const publicKey = langfuseConfig?.publicKey || process.env.LANGFUSE_PUBLIC_KEY;
    const secretKey = langfuseConfig?.secretKey || process.env.LANGFUSE_SECRET_KEY;
    const baseUrl = langfuseConfig?.baseUrl || process.env.LANGFUSE_BASE_URL || process.env.LANGFUSE_HOST;
    const enabled = langfuseConfig?.enabled ?? Boolean(publicKey && secretKey);

    if (!enabled || !publicKey || !secretKey) {
      return;
    }

    const processor = new LangfuseSpanProcessor({
      publicKey,
      secretKey,
      baseUrl,
    });
    this.otelSdk = new NodeSDK({
      spanProcessors: [processor],
      instrumentations: [],
    });
    void this.otelSdk.start();
    this.telemetryEnabled = true;
  }

  private getTelemetry(options: any) {
    if (!this.telemetryEnabled) {
      return undefined;
    }

    const runTelemetry = Observability.getTelemetry();

    if (!options.experimental_telemetry) {
      return runTelemetry || { isEnabled: true };
    }

    if (!runTelemetry) {
      return options.experimental_telemetry;
    }

    return {
      ...runTelemetry,
      ...options.experimental_telemetry,
      metadata: {
        ...runTelemetry.metadata,
        ...options.experimental_telemetry.metadata,
      },
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

    const responseMessages = response.response?.messages || [];
    if (responseMessages.length > 0) {
      conversation.messages.push(...responseMessages);
      tag('debug').log('Added', responseMessages.length, 'messages from response');
    } else {
      conversation.addAssistantText(response.text || '');
    }

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

    const telemetry = this.getTelemetry(options);
    const config = {
      ...(this.config.config || {}),
      ...options,
      ...(telemetry ? { experimental_telemetry: telemetry } : {}),
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

      if (response.usage) {
        Stats.recordTokens(options.agentName || 'unknown', model, {
          input: response.usage.promptTokens || 0,
          output: response.usage.completionTokens || 0,
          total: response.usage.totalTokens || 0,
        });
      }

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

    const telemetry = this.getTelemetry(options);
    const config = {
      tools,
      maxToolRoundtrips: options.maxToolRoundtrips || 5,
      toolChoice: 'auto',
      ...(this.config.config || {}),
      ...options,
      ...(telemetry ? { experimental_telemetry: telemetry } : {}),
      model: this.provider(model),
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

      if (response.usage) {
        Stats.recordTokens(options.agentName || 'unknown', model, {
          input: response.usage.promptTokens || 0,
          output: response.usage.completionTokens || 0,
          total: response.usage.totalTokens || 0,
        });
      }

      return response;
    } catch (error: any) {
      clearActivity();
      if (error.constructor.name === 'AI_APICallError') {
        responseLog(error.message);
        throw new AiError(error.message);
      }
      throw error;
    }
  }

  async generateObject(messages: ModelMessage[], schema: any, model?: string, options: any = {}): Promise<any> {
    const modelToUse = model || this.config.model;
    setActivity(`🤖 Asking ${modelToUse} for structured output`, 'ai');
    promptLog(`Using model: ${modelToUse}`);

    const telemetry = this.getTelemetry(options);
    const config = {
      schema,
      ...(this.config.config || {}),
      ...options,
      ...(telemetry ? { experimental_telemetry: telemetry } : {}),
      model: this.provider(modelToUse),
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

      if (response.usage) {
        Stats.recordTokens(options.agentName || 'unknown', modelToUse, {
          input: response.usage.promptTokens || 0,
          output: response.usage.completionTokens || 0,
          total: response.usage.totalTokens || 0,
        });
      }

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

    const telemetry = this.getTelemetry({});
    const config = {
      ...(this.config.config || {}),
      ...(telemetry ? { experimental_telemetry: telemetry } : {}),
      model: this.provider(this.config.visionModel),
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

      if (response.usage) {
        Stats.recordTokens('vision', this.config.visionModel!, {
          input: response.usage.promptTokens || 0,
          output: response.usage.completionTokens || 0,
          total: response.usage.totalTokens || 0,
        });
      }

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

export { AiError, Provider as AIProvider };
