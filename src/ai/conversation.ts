import type { ModelMessage } from 'ai';

export class Conversation {
  id: string;
  messages: ModelMessage[];

  constructor(messages: ModelMessage[] = []) {
    this.id = this.generateId();
    this.messages = messages;
  }

  addUserText(text: string): void {
    this.messages.push({
      role: 'user',
      content: text,
    });
  }

  addUserImage(image: string): void {
    if (!image || image.trim() === '') {
      console.warn('Warning: Attempting to add empty image to conversation');
      return;
    }

    const imageData = image.startsWith('data:') ? image : `data:image/png;base64,${image}`;

    this.messages.push({
      role: 'user',
      content: [{ type: 'image', image: imageData }],
    });
  }

  addAssistantText(text: string): void {
    this.messages.push({
      role: 'assistant',
      content: text,
    });
  }

  getLastMessage(): string {
    const lastMessage = this.messages[this.messages.length - 1];
    if (!lastMessage) return '';

    if (typeof lastMessage.content === 'string') {
      return lastMessage.content;
    }

    if (Array.isArray(lastMessage.content)) {
      const textPart = lastMessage.content.find((part) => part.type === 'text');
      return textPart ? textPart.text : '';
    }

    return '';
  }

  clone(): Conversation {
    return new Conversation([...this.messages]);
  }

  private generateId(): string {
    return `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
