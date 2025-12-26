import type { ModelMessage } from 'ai';

export class Conversation {
  id: string;
  messages: ModelMessage[];
  model: string;
  telemetryFunctionId?: string;
  private autoTrimRules: Map<string, number>;

  constructor(messages: ModelMessage[] = [], model?: string, telemetryFunctionId?: string) {
    this.id = this.generateId();
    this.messages = messages;
    this.model = model || '';
    this.telemetryFunctionId = telemetryFunctionId;
    this.autoTrimRules = new Map();
  }

  addUserText(text: string): void {
    this.messages.push({
      role: 'user',
      content: this.applyAutoTrim(text),
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
    // Skip empty or whitespace-only messages
    if (!text || text.trim() === '') {
      return;
    }
    this.messages.push({
      role: 'assistant',
      content: this.applyAutoTrim(text),
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
    return new Conversation([...this.messages], this.model, this.telemetryFunctionId);
  }

  cleanupTag(tagName: string, replacement: string, keepLast = 0): void {
    const messagesToProcess = Math.max(0, this.messages.length - keepLast);
    const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`<${escapedTag}>[\\s\\S]*?<\\/${escapedTag}>`, 'g');
    const replacementText = `<${tagName}>${replacement}</${tagName}>`;

    if (keepLast > 0 && messagesToProcess > 0) {
      const lastMessages = this.messages.slice(messagesToProcess);
      const hasTag = lastMessages.some((msg) => typeof msg.content === 'string' && new RegExp(`<${escapedTag}>`).test(msg.content));
      if (!hasTag) {
        const contentRegex = new RegExp(`<${escapedTag}>([\\s\\S]*?)<\\/${escapedTag}>`, 'g');
        const contents: string[] = [];
        for (let i = 0; i < messagesToProcess; i++) {
          const msg = this.messages[i];
          if (typeof msg.content === 'string') {
            contents.push(...[...msg.content.matchAll(contentRegex)].map((m) => m[1]));
          }
        }
        if (contents.length > 0 && typeof lastMessages[lastMessages.length - 1]?.content === 'string') {
          lastMessages[lastMessages.length - 1].content += ` <${tagName}>${contents.join('\n')}</${tagName}>`;
        }
      }
    }

    for (let i = 0; i < messagesToProcess; i++) {
      const message = this.messages[i];
      if (typeof message.content === 'string') {
        message.content = message.content.replace(regex, replacementText);
      }
    }
  }

  autoTrimTag(tagName: string, maxLength: number): void {
    this.autoTrimRules.set(tagName, maxLength);
  }

  hasTag(tagName: string, lastN?: number): boolean {
    const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`<${escapedTag}>`, 'g');

    let messagesToCheck = this.messages;
    if (lastN) {
      messagesToCheck = this.messages.slice(Math.max(0, this.messages.length - lastN));
    }

    for (const message of messagesToCheck) {
      if (typeof message.content === 'string' && regex.test(message.content)) {
        return true;
      }
    }

    return false;
  }

  private applyAutoTrim(text: string): string {
    if (this.autoTrimRules.size === 0) return text;

    let result = text;
    for (const [tagName, maxLength] of this.autoTrimRules) {
      const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`<${escapedTag}>([\\s\\S]*?)<\\/${escapedTag}>`, 'g');

      result = result.replace(regex, (match, content) => {
        if (content.length <= maxLength) return match;
        const trimmed = content.substring(0, maxLength);
        return `<${tagName}>${trimmed}</${tagName}>`;
      });
    }

    return result;
  }

  private generateId(): string {
    return `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
