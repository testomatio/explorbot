import { LangfuseSpanProcessor } from '@langfuse/otel';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { generateObject, generateText, stepCountIs } from 'ai';
import type { ModelMessage } from 'ai';
import { clearActivity, setActivity } from '../activity.ts';
import type { AIConfig } from '../config.js';
import { executionController } from '../execution-controller.ts';
import { Observability } from '../observability.ts';
import { Stats } from '../stats.ts';
import { createDebug, tag } from '../utils/logger.js';
import { type RetryOptions, withRetry } from '../utils/retry.js';
import { RulesLoader } from '../utils/rules-loader.ts';
import { Conversation } from './conversation.js';

const debugLog = createDebug('explorbot:provider');
const promptLog = createDebug('explorbot:provider:out');
const responseLog = createDebug('explorbot:provider:in');

class AiError extends Error {}
export class ContextLengthError extends Error {}

export class Provider {
  private config: AIConfig;
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
          error.message.includes('validate JSON')) &&
        !error.message.includes('output truncated at maxTokens')
      );
    },
  };

  static readonly CONTEXT_LENGTH_PATTERNS = ['reduce the length', 'context length', 'maximum context', 'token limit', 'too many tokens', 'max_tokens', 'context_length_exceeded', 'output truncated at maxtokens'];
  lastConversation: Conversation | null = null;

  constructor(config: AIConfig) {
    if (!config?.model) {
      throw new AiError('AI model is not configured. Set ai.model in your config file.');
    }
    this.config = config;
    this.initLangfuse();
  }

  private getModelName(model: any): string {
    return model?.modelId || model?.model || 'unknown';
  }

  async validateConnection(): Promise<void> {
    try {
      await generateText({
        model: this.config.model,
        prompt: 'hi',
        maxTokens: 1,
      });
    } catch (error: any) {
      throw new AiError(`AI connection failed: ${error.message}`);
    }
  }

  getModelForAgent(agentName?: string): any {
    if (!agentName) {
      return this.config.model;
    }

    const agentConfig = this.config.agents?.[agentName as keyof typeof this.config.agents];
    return agentConfig?.model || this.config.model;
  }

  getAgenticModel(agentName?: string): any {
    if (agentName) {
      const agentConfig = this.config.agents?.[agentName as keyof typeof this.config.agents];
      if (agentConfig?.model) return agentConfig.model;
    }
    return this.config.agenticModel || this.config.model;
  }

  getSystemPromptForAgent(agentName: string, currentUrl?: string): string | undefined {
    const agentConfig = this.config.agents?.[agentName as keyof typeof this.config.agents];
    const parts: string[] = [];

    if (agentConfig?.rules && currentUrl) {
      const rulesText = RulesLoader.loadRules(agentName, agentConfig.rules, currentUrl);
      if (rulesText) parts.push(rulesText);
    }

    if (agentConfig?.systemPrompt) parts.push(agentConfig.systemPrompt);

    return parts.length > 0 ? parts.join('\n\n') : undefined;
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

  startConversation(systemMessage: string, agentName?: string, model?: any) {
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

  async chat(messages: ModelMessage[], model: any, options: any = {}): Promise<any> {
    const modelName = this.getModelName(model);
    setActivity(`🤖 Asking ${modelName}`, 'ai');
    promptLog(`Using model: ${modelName}`);

    const telemetry = this.getTelemetry(options);
    const config = this.mergeProviderOptions(
      {
        maxTokens: 16384,
        ...(this.config.config || {}),
        ...options,
        ...(telemetry ? { experimental_telemetry: telemetry } : {}),
        model,
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
        Stats.recordTokens(options.agentName || 'unknown', modelName, {
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
      if (Provider.isContextLengthError(error)) {
        const reduced = this.tryReduceMessages(messages, options._contextRetryLevel || 0);
        if (reduced) {
          tag('warning').log('Context length exceeded, retrying with reduced messages...');
          return this.chat(reduced.messages, model, { ...options, _contextRetryLevel: reduced.nextLevel });
        }
        throw new ContextLengthError(error.message || error.toString());
      }
      tag('error').log(error.message || error.toString());
      throw new AiError(error.message || error.toString());
    }
  }

  async generateWithTools(messages: ModelMessage[], model: any, tools: any, options: any = {}): Promise<any> {
    const modelName = this.getModelName(model);
    setActivity(`🤖 Asking ${modelName} with dynamic tools`, 'ai');
    promptLog(`Using model: ${modelName}`);

    const toolNames = Object.keys(tools || {});
    tag('debug').log(`Tools enabled: [${toolNames.join(', ')}]`);
    promptLog('Available tools:', toolNames);
    promptLog(messages[messages.length - 1].content);

    const telemetry = this.getTelemetry(options);
    const maxRoundtrips = options.maxToolRoundtrips ?? 5;
    const config = this.mergeProviderOptions(
      {
        tools,
        maxTokens: 16384,
        stopWhen: stepCountIs(maxRoundtrips),
        toolChoice: 'auto',
        ...(this.config.config || {}),
        ...options,
        ...(telemetry ? { experimental_telemetry: telemetry } : {}),
        model,
        abortSignal: executionController.getAbortSignal(),
      },
      options.agentName
    );
    try {
      const response = await withRetry(async () => {
        const timeout = config.timeout || 30000;
        const result = (await Promise.race([
          generateText({
            messages,
            ...config,
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('AI request timeout')), timeout)),
        ])) as any;
        const hasToolCall = (result.toolCalls?.length || 0) > 0;
        if (!result.text && !hasToolCall && result.finishReason === 'length') {
          throw new ContextLengthError('AI response empty: output truncated at maxTokens. Increase maxTokens in config or use a model with higher output capacity.');
        }
        return result;
      }, this.getRetryOptions(options));

      clearActivity();

      // Log tool usage summary
      if (response.toolCalls && response.toolCalls.length > 0) {
        responseLog(response.toolCalls);
        response.toolCalls.forEach((call: any, index: number) => {
          tag('debug').log(`${call.toolName} > ${Object.values(call?.input || []).join(', ')}`);
        });
      }

      responseLog(response.text);

      if (response.usage) {
        Stats.recordTokens(options.agentName || 'unknown', modelName, {
          input: response.usage.promptTokens || 0,
          output: response.usage.completionTokens || 0,
          total: response.usage.totalTokens || 0,
        });
      }

      return response;
    } catch (error: any) {
      clearActivity();
      if (error?.message?.includes('Tool choice is required')) {
        tag('warning').log('Model completed without calling a tool, returning empty result');
        return { text: '', toolCalls: [], toolResults: [], response: { messages: [] }, usage: null };
      }
      if (error?.name === 'AbortError') throw error;
      if (error instanceof ContextLengthError) throw error;
      if (Provider.isContextLengthError(error)) {
        const reduced = this.tryReduceMessages(messages, options._contextRetryLevel || 0);
        if (reduced) {
          tag('warning').log('Context length exceeded, retrying with reduced messages...');
          return this.generateWithTools(reduced.messages, model, tools, { ...options, _contextRetryLevel: reduced.nextLevel });
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

  async generateObject(messages: ModelMessage[], schema: any, model?: any, options: any = {}): Promise<any> {
    const modelToUse = model || this.config.model;
    const modelName = this.getModelName(modelToUse);
    setActivity(`🤖 Asking ${modelName} for structured output`, 'ai');
    promptLog(`Using model: ${modelName}`);

    const telemetry = this.getTelemetry(options);
    const config = this.mergeProviderOptions(
      {
        schema,
        ...(this.config.config || {}),
        ...options,
        ...(telemetry ? { experimental_telemetry: telemetry } : {}),
        model: modelToUse,
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
        Stats.recordTokens(options.agentName || 'unknown', modelName, {
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
      if (Provider.isContextLengthError(error)) {
        const reduced = this.tryReduceMessages(messages, options._contextRetryLevel || 0);
        if (reduced) {
          tag('warning').log('Context length exceeded, retrying with reduced messages...');
          return this.generateObject(reduced.messages, schema, model, { ...options, _contextRetryLevel: reduced.nextLevel });
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

  static compactMessagesForRetry(messages: ModelMessage[]): ModelMessage[] | null {
    if (messages.length <= 5) return null;

    const head = messages[0];
    let tailStart = messages.length - 4;

    if (messages[tailStart]?.role === 'tool' && tailStart > 1) {
      tailStart--;
    }

    const tail = messages.slice(tailStart);
    const middle = messages.slice(1, tailStart);

    if (middle.length === 0) return null;

    const executions = new Conversation(middle).getToolExecutions();
    const toolStats = new Map<string, { total: number; success: number; fail: number }>();
    const urls = new Set<string>();
    const failedAttempts: string[] = [];

    for (const exec of executions) {
      const stats = toolStats.get(exec.toolName) || { total: 0, success: 0, fail: 0 };
      stats.total++;
      if (exec.wasSuccessful) stats.success++;
      else stats.fail++;
      toolStats.set(exec.toolName, stats);

      const url = exec.output?.url || exec.output?.pageDiff?.currentUrl;
      if (url) urls.add(url);

      if (!exec.wasSuccessful && failedAttempts.length < 10) {
        const inputLabel = exec.input ? Object.values(exec.input)[0] : '';
        const errorMsg = exec.output?.message || exec.output?.error || 'failed';
        failedAttempts.push(`- ${exec.toolName}("${inputLabel}"): ${errorMsg}`);
      }
    }

    let lastUserText = '';
    for (let i = middle.length - 1; i >= 0; i--) {
      if (middle[i].role === 'user' && typeof middle[i].content === 'string') {
        lastUserText = middle[i].content as string;
        break;
      }
    }

    const lines: string[] = [`[Previous conversation compacted - ${middle.length} messages summarized]`];

    if (toolStats.size > 0) {
      lines.push('', 'Actions performed:');
      for (const [name, stats] of toolStats) {
        lines.push(`- ${name}: ${stats.total} calls (${stats.success} successful${stats.fail > 0 ? `, ${stats.fail} failed` : ''})`);
      }
    }

    if (urls.size > 0) {
      lines.push('', `Pages visited: ${[...urls].join(', ')}`);
    }

    if (failedAttempts.length > 0) {
      lines.push('', 'Failed attempts:', ...failedAttempts);
    }

    if (lastUserText) {
      const truncated = lastUserText.length > 1000 ? `${lastUserText.substring(0, 1000)}...` : lastUserText;
      lines.push('', 'Last context before compaction:', truncated);
    }

    const summary: ModelMessage = { role: 'user', content: lines.join('\n') };
    return [head, summary, ...tail];
  }

  private tryReduceMessages(messages: ModelMessage[], retryLevel: number): { messages: ModelMessage[]; nextLevel: number } | null {
    if (retryLevel >= 2) return null;

    if (retryLevel === 0) {
      const trimmed = Provider.trimMessagesForRetry(messages);
      if (trimmed) return { messages: trimmed, nextLevel: 1 };
    }

    const compacted = Provider.compactMessagesForRetry(messages);
    if (compacted) return { messages: compacted, nextLevel: 2 };

    return null;
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
      model: this.config.visionModel,
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
        Stats.recordTokens('vision', this.getModelName(this.config.visionModel), {
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
