import { generateText, generateObject } from 'ai';
import type { AIConfig } from '../../explorbot.config.ts';
import { createDebug, tag } from '../utils/logger.js';
import { setActivity, clearActivity } from '../activity.ts';
import { Conversation, type Message } from './conversation.js';

const debugLog = createDebug('explorbot:ai');

export class Provider {
  private config: AIConfig;
  private provider: any = null;
  private conversations: Map<string, Conversation> = new Map();

  constructor(config: AIConfig) {
    this.config = config;
    this.provider = this.config.provider;
  }

  async startConversation(
    messages: Message[] = [],
    tools?: any
  ): Promise<{ conversation: Conversation; response: any }> {
    const conversation = new Conversation(messages);
    this.conversations.set(conversation.id, conversation);
    const response = tools
      ? await this.generateWithTools(conversation.messages, tools)
      : await this.chat(conversation.messages);
    conversation.addAssistantText(response.text);
    return { conversation, response };
  }

  async followUp(
    conversationId: string,
    tools?: any
  ): Promise<{ conversation: Conversation; response: any } | null> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) return null;
    const response = tools
      ? await this.generateWithTools(conversation.messages, tools)
      : await this.chat(conversation.messages);
    conversation.addAssistantText(response.text);
    return { conversation, response };
  }

  async chat(messages: any[], options: any = {}): Promise<any> {
    setActivity(`🤖 Asking ${this.config.model}`, 'ai');

    const config = {
      model: this.provider(this.config.model),
      ...this.config.config,
      ...options,
    };

    try {
      const timeout = config.timeout || 30000; // Default 30 seconds
      const response = (await Promise.race([
        generateText({
          messages,
          ...config,
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('AI request timeout')), timeout)
        ),
      ])) as any;

      clearActivity();
      debugLog('AI response:', response.text);
      return response;
    } catch (error: any) {
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

    const toolNames = Object.keys(tools || {});
    tag('info').log(
      `🛠️ AI Tool Calling enabled with tools: [${toolNames.join(', ')}]`
    );
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
      const timeout = config.timeout || 30000; // Default 30 seconds
      const response = (await Promise.race([
        generateText({
          messages,
          ...config,
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('AI request timeout')), timeout)
        ),
      ])) as any;

      clearActivity();

      // Log tool usage summary
      if (response.toolCalls && response.toolCalls.length > 0) {
        tag('info').log(
          `🔧 AI executed ${response.toolCalls.length} tool calls`
        );
        response.toolCalls.forEach((call: any, index: number) => {
          const args = JSON.stringify(call.args || {});
          tag('substep').log(`${index + 1}. ${call.toolName}(${args})`);
        });
      }

      // Log tool results if available
      if (response.toolResults && response.toolResults.length > 0) {
        tag('info').log(
          `📊 Tool results received: ${response.toolResults.length} results`
        );
        response.toolResults.forEach((result: any, index: number) => {
          const success = result.result?.success !== false;
          const status = success ? '✅' : '❌';
          tag('substep').log(
            `${index + 1}. ${status} ${result.toolName} → ${success ? 'Success' : result.result?.error || 'Failed'}`
          );
        });
      }

      debugLog('AI response with dynamic tools:', response.text);
      tag('info').log(
        '🎯 AI response:',
        response.text?.split('\n')[0] || 'No text response'
      );

      return response;
    } catch (error: any) {
      clearActivity();
      throw new AiError(error.message || error.toString());
    }
  }

  async generateObject(
    messages: any[],
    schema: any,
    options: any = {}
  ): Promise<any> {
    setActivity(`🤖 Asking ${this.config.model} for structured output`, 'ai');

    const config = {
      model: this.provider(this.config.model),
      schema,
      ...this.config.config,
      ...options,
    };

    try {
      const timeout = config.timeout || 30000; // Default 30 seconds
      const response = (await Promise.race([
        generateObject({
          messages,
          ...config,
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('AI request timeout')), timeout)
        ),
      ])) as any;

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
}

class AiError extends Error {}

export { AiError, Provider as AIProvider };
