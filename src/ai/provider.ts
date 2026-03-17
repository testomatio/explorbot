import { LangfuseSpanProcessor } from '@langfuse/otel';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { generateObject, generateText } from 'ai';
import type { ModelMessage } from 'ai';
import { clearActivity, setActivity } from '../activity.ts';
import type { AIConfig } from '../config.js';
import { executionController } from '../execution-controller.ts';
import { Observability } from '../observability.ts';
import { Stats } from '../stats.ts';
import { createDebug, tag } from '../utils/logger.js';
import { type RetryOptions, withRetry } from '../utils/retry.js';
import { Conversation } from './conversation.js';

const debugLog = createDebug('explorbot:provider');
const promptLog = createDebug('explorbot:provider:out');
const responseLog = createDebug('explorbot:provider:in');

class AiError extends Error {}
export class ContextLengthError extends Error {}

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
      return (
        (error.name === 'AI_APICallError' ||
          error.message.includes('timeout') ||
          error.message.includes('network') ||
          error.message.includes('rate limit') ||
          error.message.includes('AI request timeout') ||
          error.message.includes('schema') ||
          error.message.includes('No object generated') ||
          error.message.includes('No response text') ||
          error.message.includes('Tool choice is required') ||
          error.message.includes('validate JSON')) &&
        !error.message.includes('output truncated at maxTokens')
      );
    },
  };

  static readonly CONTEXT_LENGTH_PATTERNS = ['reduce the length', 'context length', 'maximum context', 'token limit', 'too many tokens', 'max_tokens', 'context_length_exceeded', 'output truncated at maxtokens'];
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

  getAgenticModel(agentName?: string): string {
    if (agentName) {
      const agentConfig = this.config.agents?.[agentName as keyof typeof this.config.agents];
      if (agentConfig?.model) return agentConfig.model;
    }
    return this.config.agenticModel || this.config.model;
  }

  getSystemPromptForAgent(agentName: string): string | undefined {
    const agentConfig = this.config.agents?.[agentName as keyof typeof this.config.agents];
    return agentConfig?.systemPrompt;
  }

  getProviderOptionsForAgent(agentName: string): Record<string, any> | undefined {
    const agentConfig = this.config.agents?.[agentName as keyof typeof this.config.agents];
    return agentConfig?.providerOptions;
  }

  private getRetryOptions(options: any = {}): RetryOptions {
    return {
      ...this.defaultRetryOptions,
      maxAttempts: options.maxRetries || this.defaultRetryOptions.maxAttempts,
    };
  }

  private mergeProviderOptions(config: Record<string, any>, agentName?: string): Record<string, any> {
    if (!agentName) return config;
    const agentOptions = this.getProviderOptionsForAgent(agentName);
    if (!agentOptions) return config;
    return {
      ...config,
      providerOptions: { ...config.providerOptions, ...agentOptions },
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

  startConversation(systemMessage: string, agentName?: string, model?: string) {
    const resolvedModel = model || this.getModelForAgent(agentName);
    return new Conversation(
      [
        {
          role: 'system',
          content: systemMessage,
        },
      ],
      resolvedModel
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
    const config = this.mergeProviderOptions(
      {
        maxTokens: 16384,
        ...(this.config.config || {}),
        ...options,
        ...(telemetry ? { experimental_telemetry: telemetry } : {}),
        model: this.provider(model),
        abortSignal: executionController.getAbortSignal(),
      },
      options.agentName
    );

    promptLog(messages[messages.length - 1].content);
    try {
      const response = await withRetry(async () => {
        const result = await generateText({ messages, ...config });
        if (!result.text) {
          debugLog(result);
          if (result.finishReason === 'length') {
            throw new ContextLengthError('AI response empty: output truncated at maxTokens. Increase maxTokens in config or use a model with higher output capacity.');
          }
          throw new Error('No response text from AI');
        }
        if (result.finishReason === 'length') {
          debugLog('finishReason=length, response may be truncated');
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
      clearActivity();
      if (error?.name === 'AbortError') throw error;
      if (error instanceof ContextLengthError) throw error;
      if (!options._noContextRetry && Provider.isContextLengthError(error)) {
        const trimmed = Provider.trimMessagesForRetry(messages);
        if (trimmed) {
          tag('warning').log('Context length exceeded, retrying chat with trimmed messages...');
          return this.chat(trimmed, model, { ...options, _noContextRetry: true });
        }
        throw new ContextLengthError(error.message || error.toString());
      }
      tag('error').log(error.message || error.toString());
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
    const config = this.mergeProviderOptions(
      {
        tools,
        maxTokens: 16384,
        maxToolRoundtrips: options.maxToolRoundtrips ?? 5,
        toolChoice: 'auto',
        ...(this.config.config || {}),
        ...options,
        ...(telemetry ? { experimental_telemetry: telemetry } : {}),
        model: this.provider(model),
        abortSignal: executionController.getAbortSignal(),
      },
      options.agentName
    );
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
      if (error?.name === 'AbortError') throw error;
      if (error instanceof ContextLengthError) throw error;
      if (!options._noContextRetry && Provider.isContextLengthError(error)) {
        const trimmed = Provider.trimMessagesForRetry(messages);
        if (trimmed) {
          tag('warning').log('Context length exceeded, retrying generateWithTools with trimmed messages...');
          return this.generateWithTools(trimmed, model, tools, { ...options, _noContextRetry: true });
        }
        throw new ContextLengthError(error.message || error.toString());
      }
      if (error.constructor?.name === 'AI_APICallError') {
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
    const config = this.mergeProviderOptions(
      {
        schema,
        ...(this.config.config || {}),
        ...options,
        ...(telemetry ? { experimental_telemetry: telemetry } : {}),
        model: this.provider(modelToUse),
        abortSignal: executionController.getAbortSignal(),
      },
      options.agentName
    );

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
      if (error?.name === 'AbortError') throw error;
      if (error instanceof ContextLengthError) throw error;
      if (!options._noContextRetry && Provider.isContextLengthError(error)) {
        const trimmed = Provider.trimMessagesForRetry(messages);
        if (trimmed) {
          tag('warning').log('Context length exceeded, retrying with trimmed messages...');
          return this.generateObject(trimmed, schema, model, { ...options, _noContextRetry: true });
        }
        throw new ContextLengthError(error.message || error.toString());
      }
      throw new AiError(error.message || error.toString());
    }
  }

  static isContextLengthError(error: any): boolean {
    const msg = (error?.message || error?.toString() || '').toLowerCase();
    return Provider.CONTEXT_LENGTH_PATTERNS.some((p) => msg.includes(p));
  }

  static trimMessagesForRetry(messages: ModelMessage[]): ModelMessage[] | null {
    const tagRegex = /<(\w[\w-]*)>([\s\S]*?)<\/\1>/g;
    let didTrim = false;

    const trimmed = messages.map((msg, idx) => {
      if (typeof msg.content === 'string') {
        const newContent = msg.content.replace(tagRegex, (match, tagName, content) => {
          if (content.length > 2000) {
            didTrim = true;
            return `<${tagName}>${content.substring(0, Math.floor(content.length / 2))}\n[...trimmed...]</${tagName}>`;
          }
          return match;
        });
        return { ...msg, content: newContent };
      }

      if (msg.role === 'tool' && Array.isArray(msg.content) && idx < messages.length - 3) {
        const newContent = (msg.content as any[]).map((part: any) => {
          if (part.type !== 'tool-result' || !part.output) return part;
          const output = part.output?.type === 'json' ? part.output.value : part.output;
          if (!output || typeof output !== 'object') return part;
          const json = JSON.stringify(output);
          if (json.length < 2000) return part;
          didTrim = true;
          const trimmedOutput = { success: output.success, action: output.action, trimmed: true };
          return { ...part, output: part.output?.type === 'json' ? { type: 'json', value: trimmedOutput } : trimmedOutput };
        });
        return { ...msg, content: newContent };
      }

      return msg;
    });

    return didTrim ? trimmed : null;
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
      maxTokens: 16384,
      ...(this.config.config || {}),
      ...(telemetry ? { experimental_telemetry: telemetry } : {}),
      model: this.provider(this.config.visionModel),
      abortSignal: executionController.getAbortSignal(),
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
      if (error?.name === 'AbortError') throw error;
      throw new AiError(error.message || error.toString());
    }
  }

  hasVision(): boolean {
    return this.config.visionModel !== undefined;
  }
}

export { AiError, Provider as AIProvider };
