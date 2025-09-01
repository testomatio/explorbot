import { generateText } from 'ai';
import type { AIConfig } from '../../explorbot.config.ts';
import { createDebug } from '../utils/logger.js';
import { setActivity, clearActivity } from '../activity.js';
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
    const response = await this.chat(conversation.messages, { tools });
    conversation.addAssistantText(response.text);
    return { conversation, response };
  }

  async followUp(
    conversationId: string,
    tools?: any
  ): Promise<{ conversation: Conversation; response: any } | null> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) return null;
    const response = await this.chat(conversation.messages, { tools });
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

  async generateWithTools(
    messages: any[],
    tools: any,
    options: any = {}
  ): Promise<any> {
    setActivity(`🤖 Asking ${this.config.model} with dynamic tools`, 'ai');

    const config = {
      model: this.provider(this.config.model),
      tools,
      maxToolRoundtrips: options.maxToolRoundtrips || 5,
      toolChoice: 'auto',
      ...this.config.config,
      ...options,
    };

    try {
      const response = await generateText({
        messages,
        ...config,
      });

      clearActivity();
      debugLog('AI response with dynamic tools:', response.text);
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
