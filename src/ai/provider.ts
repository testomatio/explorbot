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

  async startConversation(messages: Message[] = []): Promise<Conversation> {
    const conversation = new Conversation(messages);
    this.conversations.set(conversation.id, conversation);
    const response = await this.chat(conversation.messages);
    conversation.addAssistantText(response.text);
    return conversation;
  }

  async followUp(conversationId: string): Promise<Conversation | null> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) return null;
    const response = await this.chat(conversation.messages);
    conversation.addAssistantText(response.text);
    return conversation;
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

  getProvider(): any {
    return this.provider;
  }

}

class AiError extends Error {}

export { AiError, Provider as AIProvider };
