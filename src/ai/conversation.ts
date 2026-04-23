import type { ModelMessage } from 'ai';

export interface ToolExecution {
  toolName: string;
  input: any;
  output: any;
  wasSuccessful: boolean;
}

export function toolExecutionLabel(input: Record<string, any> | undefined): string {
  return input?.explanation || input?.assertion || input?.reason || input?.request || '';
}

const AUTO_COMPACT_ARIA_CHANGES_CUTOFF = 500;
const AUTO_COMPACT_TARGETED_HTML_CUTOFF = 500;

export class Conversation {
  id: string;
  messages: ModelMessage[];
  model: any;
  telemetryFunctionId?: string;
  private autoTrimRules: Map<string, number>;

  constructor(messages: ModelMessage[] = [], model?: any, telemetryFunctionId?: string) {
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
    const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`<${escapedTag}>[\\s\\S]*?<\\/${escapedTag}>`, 'g');
    const replacementText = `<${tagName}>${replacement}</${tagName}>`;

    if (keepLast === 0) {
      for (const message of this.messages) {
        if (typeof message.content === 'string') {
          message.content = message.content.replace(regex, replacementText);
        }
      }
      return;
    }

    const allMatches: Array<{ messageIndex: number; startIndex: number; endIndex: number }> = [];
    for (let i = 0; i < this.messages.length; i++) {
      const message = this.messages[i];
      if (typeof message.content === 'string') {
        const matches = [...message.content.matchAll(new RegExp(`<${escapedTag}>[\\s\\S]*?<\\/${escapedTag}>`, 'g'))];
        for (const match of matches) {
          if (match.index !== undefined) {
            allMatches.push({ messageIndex: i, startIndex: match.index, endIndex: match.index + match[0].length });
          }
        }
      }
    }

    const keepCount = Math.min(keepLast, allMatches.length);
    const keepMatches = allMatches.slice(-keepCount);
    const keepSet = new Set(keepMatches.map((m) => `${m.messageIndex}:${m.startIndex}`));

    for (let i = 0; i < this.messages.length; i++) {
      const message = this.messages[i];
      if (typeof message.content === 'string') {
        const matches = [...message.content.matchAll(new RegExp(`<${escapedTag}>[\\s\\S]*?<\\/${escapedTag}>`, 'g'))];
        let result = message.content;
        for (let j = matches.length - 1; j >= 0; j--) {
          const match = matches[j];
          if (match.index !== undefined) {
            const key = `${i}:${match.index}`;
            if (!keepSet.has(key)) {
              result = result.substring(0, match.index) + replacementText + result.substring(match.index + match[0].length);
            }
          }
        }
        message.content = result;
      }
    }
  }

  autoTrimTag(tagName: string, maxLength: number): void {
    this.autoTrimRules.set(tagName, maxLength);
  }

  compactToolResults(keepLastN: number): void {
    const toolMessageIndexes: number[] = [];
    for (let i = 0; i < this.messages.length; i++) {
      if (this.messages[i].role === 'tool') toolMessageIndexes.push(i);
    }
    const compactUpTo = toolMessageIndexes.length - Math.max(0, keepLastN);
    for (let k = 0; k < compactUpTo; k++) {
      const message = this.messages[toolMessageIndexes[k]];
      if (!Array.isArray(message.content)) continue;
      for (const part of message.content) {
        if (part.type !== 'tool-result') continue;
        const rawOutput = part.output as Record<string, any> | undefined;
        if (!rawOutput || rawOutput.type !== 'json' || !rawOutput.value || typeof rawOutput.value !== 'object') continue;
        const value = rawOutput.value as Record<string, any>;
        if (value.pageDiff && typeof value.pageDiff === 'object') {
          const pageDiff = value.pageDiff as Record<string, any>;
          if (Array.isArray(pageDiff.htmlParts)) {
            pageDiff.htmlParts = undefined;
            pageDiff.compacted = true;
          }
          if (typeof pageDiff.ariaChanges === 'string' && pageDiff.ariaChanges.length > AUTO_COMPACT_ARIA_CHANGES_CUTOFF) {
            pageDiff.ariaChanges = `${pageDiff.ariaChanges.slice(0, AUTO_COMPACT_ARIA_CHANGES_CUTOFF)}...`;
          }
          if (typeof pageDiff.iframes === 'string') {
            pageDiff.iframes = undefined;
          }
        }
        if (typeof value.targetedHtml === 'string' && value.targetedHtml.length > AUTO_COMPACT_TARGETED_HTML_CUTOFF) {
          value.targetedHtml = `${value.targetedHtml.slice(0, AUTO_COMPACT_TARGETED_HTML_CUTOFF)}...`;
        }
      }
    }
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

  getToolExecutions(): ToolExecution[] {
    const toolCalls = new Map<string, any>();
    for (const message of this.messages) {
      if (message.role !== 'assistant') continue;
      if (!Array.isArray(message.content)) continue;
      for (const part of message.content) {
        if (part.type !== 'tool-call') continue;
        toolCalls.set(part.toolCallId, part.input);
      }
    }

    const executions: ToolExecution[] = [];
    for (const message of this.messages) {
      if (message.role !== 'tool') continue;
      if (!Array.isArray(message.content)) continue;
      for (const part of message.content) {
        if (part.type !== 'tool-result') continue;
        const rawOutput = part.output as Record<string, any>;
        const output = rawOutput?.type === 'json' && rawOutput?.value ? rawOutput.value : rawOutput;
        executions.push({
          toolName: part.toolName,
          input: toolCalls.get(part.toolCallId) || {},
          output,
          wasSuccessful: output?.success !== false,
        });
      }
    }

    return executions;
  }
}
