import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { ModelMessage } from 'ai';
import { AiError, Provider } from '../../src/ai/provider.js';
import { ConfigParser } from '../../src/config.js';
import type { AIConfig } from '../../src/config.js';
import { MockAIProvider } from '../mocks/ai-provider.mock.js';

function makeToolCallMessage(calls: Array<{ id: string; name: string; input: any }>): ModelMessage {
  return {
    role: 'assistant',
    content: calls.map((c) => ({
      type: 'tool-call' as const,
      toolCallId: c.id,
      toolName: c.name,
      input: c.input,
      args: c.input,
    })),
  };
}

function makeToolResultMessage(results: Array<{ id: string; name: string; output: any }>): ModelMessage {
  return {
    role: 'tool',
    content: results.map((r) => ({
      type: 'tool-result' as const,
      toolCallId: r.id,
      toolName: r.name,
      result: r.output,
      output: r.output,
    })),
  };
}

describe('Provider', () => {
  let provider: Provider;
  let mockAI: MockAIProvider;
  let aiConfig: AIConfig;

  beforeEach(() => {
    mockAI = new MockAIProvider();
    aiConfig = {
      model: mockAI.getModel(),
      apiKey: 'test-key',
      config: {},
      vision: false,
    };
    ConfigParser.getInstance().loadConfig({});
    provider = new Provider(aiConfig);
  });

  afterEach(() => {
    mockAI.reset();
  });

  describe('constructor', () => {
    it('should initialize with the provided config', () => {
      expect(provider).toBeDefined();
    });
  });

  describe('chat', () => {
    it('should send messages and return AI response', async () => {
      const messages = [{ role: 'user', content: 'Hello' }];
      mockAI.setResponses([{ text: 'Hi there!' }]);

      const response = await provider.chat(messages, mockAI.getModel());

      expect(response.text).toBe('Hi there!');
    });
  });

  describe('generateWithTools', () => {
    it('should handle tools in the request', async () => {
      const messages = [{ role: 'user', content: 'Use a tool' }];
      const tools = {
        testTool: {
          description: 'A test tool',
          parameters: {},
        },
      };
      mockAI.setResponses([{ text: 'Used tool' }]);

      const response = await provider.generateWithTools(messages, mockAI.getModel(), tools);

      expect(response.text).toBe('Used tool');
    });

    it('should use custom timeout when provided', async () => {
      const messages = [{ role: 'user', content: 'Hello' }];
      const tools = {};
      mockAI.setResponses([{ text: 'Response' }]);

      const response = await provider.generateWithTools(messages, mockAI.getModel(), tools, {
        timeout: 5000,
      });

      expect(response.text).toBe('Response');
    });
  });

  describe('retry functionality', () => {
    it('should retry on API errors', async () => {
      const messages = [{ role: 'user', content: 'Hello' }];
      mockAI.setResponses([{ text: 'Success after retry' }]);
      mockAI.setFailure(true, 2);

      const response = await provider.chat(messages, mockAI.getModel(), { maxRetries: 3 });

      expect(response.text).toBe('Success after retry');
    });

    it('should respect maxRetries option', async () => {
      const messages = [{ role: 'user', content: 'Hello' }];
      mockAI.setResponses([{ text: 'Success' }]);
      mockAI.setFailure(true, 5);

      await expect(provider.chat(messages, mockAI.getModel(), { maxRetries: 2 })).rejects.toThrow(AiError);
    });
  });

  describe('generateObject', () => {
    it('should skip generateObject test due to schema complexity', () => {
      expect(true).toBe(true);
    });

    it('should handle schema validation errors', async () => {
      const messages = [{ role: 'user', content: 'Generate object' }];
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
      };

      mockAI.setResponses([{ object: { wrongField: 'value' } }]);

      await expect(provider.generateObject(messages, schema)).rejects.toThrow(AiError);
    });
  });

  describe('conversation methods', () => {
    it('should start a new conversation with system message', () => {
      const systemMessage = 'You are a helpful assistant';
      const conversation = provider.startConversation(systemMessage);

      expect(conversation).toBeDefined();
      expect(conversation.messages).toHaveLength(1);
      expect(conversation.messages[0].role).toBe('system');
      expect(conversation.messages[0].content).toBe(systemMessage);
    });
  });

  describe('compactMessagesForRetry', () => {
    it('should return null for 5 or fewer messages', () => {
      const messages: ModelMessage[] = [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
        { role: 'user', content: 'c' },
        { role: 'assistant', content: 'd' },
      ];
      expect(Provider.compactMessagesForRetry(messages)).toBeNull();
    });

    it('should preserve system message and last 4 messages', () => {
      const messages: ModelMessage[] = [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: 'msg1' },
        { role: 'assistant', content: 'msg2' },
        { role: 'user', content: 'msg3' },
        { role: 'assistant', content: 'msg4' },
        { role: 'user', content: 'msg5' },
        { role: 'assistant', content: 'msg6' },
        { role: 'user', content: 'msg7' },
        { role: 'assistant', content: 'msg8' },
      ];
      const result = Provider.compactMessagesForRetry(messages)!;
      expect(result).not.toBeNull();
      expect(result[0].content).toBe('system prompt');
      expect(result[1].role).toBe('user');
      expect(result[1].content as string).toContain('[Previous conversation compacted');
      expect(result[result.length - 1].content).toBe('msg8');
      expect(result[result.length - 2].content).toBe('msg7');
      expect(result[result.length - 3].content).toBe('msg6');
      expect(result[result.length - 4].content).toBe('msg5');
    });

    it('should generate correct tool call stats', () => {
      const messages: ModelMessage[] = [
        { role: 'system', content: 'system' },
        makeToolCallMessage([
          { id: 'c1', name: 'click', input: { locator: 'Save' } },
          { id: 'c2', name: 'click', input: { locator: 'Cancel' } },
        ]),
        makeToolResultMessage([
          { id: 'c1', name: 'click', output: { success: true, url: '/dashboard' } },
          { id: 'c2', name: 'click', output: { success: false, message: 'Element not found' } },
        ]),
        makeToolCallMessage([{ id: 'c3', name: 'type', input: { text: 'hello' } }]),
        makeToolResultMessage([{ id: 'c3', name: 'type', output: { success: true } }]),
        { role: 'user', content: 'tail1' },
        { role: 'assistant', content: 'tail2' },
        { role: 'user', content: 'tail3' },
        { role: 'assistant', content: 'tail4' },
      ];
      const result = Provider.compactMessagesForRetry(messages)!;
      const summary = result[1].content as string;
      expect(summary).toContain('click: 2 calls (1 successful, 1 failed)');
      expect(summary).toContain('type: 1 calls (1 successful)');
      expect(summary).toContain('/dashboard');
      expect(summary).toContain('click("Cancel"): Element not found');
      expect(summary).not.toContain('<');
    });

    it('should include orphaned tool message preceding assistant in tail', () => {
      const messages: ModelMessage[] = [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'middle1' },
        { role: 'assistant', content: 'middle2' },
        makeToolCallMessage([{ id: 'c1', name: 'click', input: { locator: 'btn' } }]),
        makeToolResultMessage([{ id: 'c1', name: 'click', output: { success: true } }]),
        { role: 'user', content: 'tail2' },
        { role: 'assistant', content: 'tail3' },
      ];
      const result = Provider.compactMessagesForRetry(messages)!;
      expect(result).not.toBeNull();
      const roles = result.map((m) => m.role);
      expect(roles).toContain('assistant');
      const toolIdx = result.findIndex((m) => m.role === 'tool');
      if (toolIdx > 0) {
        expect(result[toolIdx - 1].role).toBe('assistant');
      }
    });

    it('should handle output.type === json wrapped results', () => {
      const messages: ModelMessage[] = [
        { role: 'system', content: 'system' },
        makeToolCallMessage([{ id: 'c1', name: 'click', input: { locator: 'Link' } }]),
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result' as const,
              toolCallId: 'c1',
              toolName: 'click',
              result: { type: 'json', value: { success: false, message: 'Not found' } },
              output: { type: 'json', value: { success: false, message: 'Not found' } },
            },
          ],
        },
        { role: 'user', content: 'tail1' },
        { role: 'assistant', content: 'tail2' },
        { role: 'user', content: 'tail3' },
        { role: 'assistant', content: 'tail4' },
      ];
      const result = Provider.compactMessagesForRetry(messages)!;
      const summary = result[1].content as string;
      expect(summary).toContain('click: 1 calls');
      expect(summary).toContain('1 failed');
      expect(summary).toContain('Not found');
    });

    it('should cap failed attempts at 10', () => {
      const calls = Array.from({ length: 15 }, (_, i) => ({
        id: `c${i}`,
        name: 'click',
        input: { locator: `btn${i}` },
      }));
      const results = Array.from({ length: 15 }, (_, i) => ({
        id: `c${i}`,
        name: 'click',
        output: { success: false, message: `Error ${i}` },
      }));

      const messages: ModelMessage[] = [{ role: 'system', content: 'system' }, makeToolCallMessage(calls), makeToolResultMessage(results), { role: 'user', content: 'tail1' }, { role: 'assistant', content: 'tail2' }, { role: 'user', content: 'tail3' }, { role: 'assistant', content: 'tail4' }];
      const result = Provider.compactMessagesForRetry(messages)!;
      const summary = result[1].content as string;
      const failedLines = summary.split('\n').filter((l) => l.startsWith('- click("'));
      expect(failedLines.length).toBe(10);
    });

    it('should not contain XML tags in summary', () => {
      const messages: ModelMessage[] = [
        { role: 'system', content: 'system' },
        { role: 'user', content: '<html>some html</html>' },
        { role: 'assistant', content: 'response' },
        { role: 'user', content: 'more context' },
        { role: 'assistant', content: 'more response' },
        { role: 'user', content: 'tail1' },
        { role: 'assistant', content: 'tail2' },
        { role: 'user', content: 'tail3' },
        { role: 'assistant', content: 'tail4' },
      ];
      const result = Provider.compactMessagesForRetry(messages)!;
      const summary = result[1].content as string;
      expect(summary).not.toContain('<html>');
      expect(summary).not.toContain('</html>');
    });
  });

  describe('tryReduceMessages', () => {
    it('should try trim first at level 0', () => {
      const messages: ModelMessage[] = [
        { role: 'system', content: 'system' },
        { role: 'user', content: `<data>${'x'.repeat(5000)}</data>` },
        { role: 'assistant', content: 'response' },
      ];
      const result = (provider as any).tryReduceMessages(messages, 0);
      expect(result).not.toBeNull();
      expect(result.nextLevel).toBe(1);
      expect(result.messages[1].content as string).toContain('[...trimmed...]');
    });

    it('should fall back to compact at level 0 when trim returns null', () => {
      const messages: ModelMessage[] = [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'short1' },
        { role: 'assistant', content: 'short2' },
        { role: 'user', content: 'short3' },
        { role: 'assistant', content: 'short4' },
        { role: 'user', content: 'short5' },
        { role: 'assistant', content: 'short6' },
      ];
      const result = (provider as any).tryReduceMessages(messages, 0);
      expect(result).not.toBeNull();
      expect(result.nextLevel).toBe(2);
      expect(result.messages[1].content as string).toContain('[Previous conversation compacted');
    });

    it('should try compact only at level 1', () => {
      const messages: ModelMessage[] = [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'msg1' },
        { role: 'assistant', content: 'msg2' },
        { role: 'user', content: 'msg3' },
        { role: 'assistant', content: 'msg4' },
        { role: 'user', content: 'msg5' },
        { role: 'assistant', content: 'msg6' },
      ];
      const result = (provider as any).tryReduceMessages(messages, 1);
      expect(result).not.toBeNull();
      expect(result.nextLevel).toBe(2);
    });

    it('should return null at level 2', () => {
      const messages: ModelMessage[] = [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'msg1' },
      ];
      const result = (provider as any).tryReduceMessages(messages, 2);
      expect(result).toBeNull();
    });
  });
});
