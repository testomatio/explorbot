import { describe, it, expect, beforeEach, mock, spyOn } from 'bun:test';
import { Provider, AiError } from '../../src/ai/provider.js';
import type { AIConfig } from '../../src/config.js';

// Mock the 'ai' module
const mockGenerateText = mock(() => Promise.resolve({ text: 'Test response' }));
mock.module('ai', () => ({
  generateText: mockGenerateText,
}));

// Mock activity functions
mock.module('../../src/activity.js', () => ({
  setActivity: mock(() => {}),
  clearActivity: mock(() => {}),
}));

describe('AI Provider', () => {
  let provider: Provider;
  let mockConfig: AIConfig;

  beforeEach(() => {
    mockConfig = {
      provider: mock((model: string) => ({ model })),
      model: 'test-model',
      config: {
        temperature: 0.5,
      },
    };
    provider = new Provider(mockConfig);
    mockGenerateText.mockClear();
  });

  describe('constructor', () => {
    it('should create provider with config', () => {
      expect(provider).toBeInstanceOf(Provider);
      expect(provider.getProvider()).toBe(mockConfig.provider);
    });
  });

  describe('chat', () => {
    it('should call generateText with correct parameters', async () => {
      const messages = [{ role: 'user', content: 'Hello' }];
      const options = { maxTokens: 100 };

      await provider.chat(messages, options);

      expect(mockGenerateText).toHaveBeenCalledWith({
        messages,
        model: { model: 'test-model' },
        temperature: 0.5,
        maxTokens: 100,
      });
    });

    it('should return AI response', async () => {
      mockGenerateText.mockResolvedValueOnce({ text: 'AI response' });

      const result = await provider.chat([{ role: 'user', content: 'Hello' }]);

      expect(result.text).toBe('AI response');
    });

    it('should throw AiError on failure', async () => {
      mockGenerateText.mockRejectedValueOnce(new Error('API Error'));

      await expect(
        provider.chat([{ role: 'user', content: 'Hello' }])
      ).rejects.toThrow(AiError);
    });
  });

  describe('generateWithTools', () => {
    it('should call generateText with tools and maxToolRoundtrips', async () => {
      const messages = [{ role: 'user', content: 'Hello' }];
      const tools = { testTool: {} };
      const options = { maxToolRoundtrips: 3 };

      await provider.generateWithTools(messages, tools, options);

      expect(mockGenerateText).toHaveBeenCalledWith({
        messages,
        model: { model: 'test-model' },
        tools,
        maxToolRoundtrips: 3,
        toolChoice: 'auto',
        temperature: 0.5,
      });
    });

    it('should use default maxToolRoundtrips when not specified', async () => {
      const messages = [{ role: 'user', content: 'Hello' }];
      const tools = { testTool: {} };

      await provider.generateWithTools(messages, tools);

      expect(mockGenerateText).toHaveBeenCalledWith({
        messages,
        model: { model: 'test-model' },
        tools,
        maxToolRoundtrips: 5,
        toolChoice: 'auto',
        temperature: 0.5,
      });
    });

    it('should return AI response with tools', async () => {
      mockGenerateText.mockResolvedValueOnce({
        text: 'Tool response',
        toolCalls: [{ toolName: 'test', result: 'success' }],
      });

      const result = await provider.generateWithTools(
        [{ role: 'user', content: 'Hello' }],
        { testTool: {} }
      );

      expect(result.text).toBe('Tool response');
      expect(result.toolCalls).toHaveLength(1);
    });

    it('should throw AiError on failure', async () => {
      mockGenerateText.mockRejectedValueOnce(new Error('Tool API Error'));

      await expect(
        provider.generateWithTools([{ role: 'user', content: 'Hello' }], {})
      ).rejects.toThrow(AiError);
    });
  });

  describe('startConversation', () => {
    it('should create conversation and return both conversation and response', async () => {
      mockGenerateText.mockResolvedValueOnce({ text: 'Initial response' });

      const messages = [
        { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
      ];
      const { conversation, response } =
        await provider.startConversation(messages);

      expect(conversation).toBeDefined();
      expect(conversation.messages).toHaveLength(2); // Initial + assistant response
      expect(response.text).toBe('Initial response');
    });

    it('should support tools in startConversation', async () => {
      mockGenerateText.mockResolvedValueOnce({
        text: 'Tool conversation started',
      });

      const messages = [
        { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
      ];
      const tools = { testTool: {} };

      const { conversation, response } = await provider.startConversation(
        messages,
        tools
      );

      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              content: expect.arrayContaining([
                expect.objectContaining({ type: 'text', text: 'Hello' }),
              ]),
            }),
          ]),
          tools,
        })
      );
    });
  });

  describe('followUp', () => {
    it('should continue existing conversation', async () => {
      // Start conversation first
      mockGenerateText.mockResolvedValueOnce({ text: 'Initial response' });
      const { conversation } = await provider.startConversation([
        { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
      ]);

      // Follow up
      mockGenerateText.mockResolvedValueOnce({ text: 'Follow up response' });
      const followUpResult = await provider.followUp(conversation.id);

      expect(followUpResult).toBeDefined();
      expect(followUpResult!.conversation.messages).toHaveLength(3); // Initial + assistant + follow up
      expect(followUpResult!.response.text).toBe('Follow up response');
    });

    it('should return null for non-existent conversation', async () => {
      const result = await provider.followUp('non-existent-id');
      expect(result).toBeNull();
    });

    it('should support tools in followUp', async () => {
      // Start conversation first
      mockGenerateText.mockResolvedValueOnce({ text: 'Initial response' });
      const { conversation } = await provider.startConversation([
        { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
      ]);

      // Follow up with tools
      mockGenerateText.mockResolvedValueOnce({ text: 'Follow up with tools' });
      const tools = { testTool: {} };

      await provider.followUp(conversation.id, tools);

      expect(mockGenerateText).toHaveBeenLastCalledWith(
        expect.objectContaining({
          messages: expect.any(Array),
          tools,
        })
      );
    });
  });
});
