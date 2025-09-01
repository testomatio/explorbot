export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: Array<{
    type: 'text' | 'image';
    text?: string;
    image?: string;
  }>;
}

export class Conversation {
  id: string;
  messages: Message[];

  constructor(messages: Message[] = []) {
    this.id = this.generateId();
    this.messages = messages;
  }

  addUserText(text: string): void {
    this.messages.push({
      role: 'user',
      content: [{ type: 'text', text }],
    });
  }

  addUserImage(image: string): void {
    this.messages.push({
      role: 'user',
      content: [{ type: 'image', image }],
    });
  }

  addAssistantText(text: string): void {
    this.messages.push({
      role: 'assistant',
      content: [{ type: 'text', text }],
    });
  }

  getLastMessage(): string {
    return this.messages[this.messages.length - 1].content[0].text || '';
  }

  clone(): Conversation {
    return new Conversation([...this.messages]);
  }

  private generateId(): string {
    return `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
