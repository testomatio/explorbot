// Mock provider utilities for testing AI interactions
export interface MockResponse {
  text?: string;
  toolCalls?: Array<{
    toolName: string;
    args: any;
  }>;
  toolResults?: Array<{
    toolName: string;
    result: any;
  }>;
}

export interface MockProviderConfig {
  responses?: MockResponse[];
  simulateError?: boolean;
  errorType?: 'timeout' | 'api' | 'network';
  delay?: number;
}

/**
 * Creates a mock AI provider for testing
 */
export function createMockProvider(config: MockProviderConfig = {}) {
  const {
    responses = [{ text: 'Mock AI response' }],
    simulateError = false,
    errorType = 'api',
    delay = 0,
  } = config;

  let callCount = 0;

  const mockProvider = {
    async generateText(messages: any[], options: any = {}) {
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      if (simulateError) {
        throw new Error(`Mock ${errorType} error`);
      }

      const response = responses[callCount] || responses[responses.length - 1];
      callCount++;

      return {
        text: response.text || 'Mocked response',
        usage: { totalTokens: 100, promptTokens: 50, completionTokens: 50 },
      };
    },

    async generateWithTools(messages: any[], tools: any, options: any = {}) {
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      if (simulateError) {
        throw new Error(`Mock ${errorType} error with tools`);
      }

      const response = responses[callCount] || responses[responses.length - 1];
      callCount++;

      // Find the first tool that would be called
      const toolName = Object.keys(tools)[0];

      return {
        text: response.text || 'Mocked response with tools',
        toolCalls: response.toolCalls || [
          {
            toolName: toolName || 'mockTool',
            args: response.toolArgs || {},
          },
        ],
        toolResults: response.toolResults || [
          {
            toolName: toolName || 'mockTool',
            result: {
              success: true,
              ...response.toolResult,
            },
          },
        ],
      };
    },

    async generateObject(messages: any[], schema: any, options: any = {}) {
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      if (simulateError) {
        throw new Error(`Mock ${errorType} error for object generation`);
      }

      const response = responses[callCount] || responses[responses.length - 1];
      callCount++;

      return {
        object: response.object || { mocked: true },
        usage: { totalTokens: 100, promptTokens: 50, completionTokens: 50 },
      };
    },

    async startConversation(messages: any[] = [], tools?: any) {
      const response = await this.generateWithTools(messages, tools || {});
      const conversation = {
        id: 'mock-conversation-' + Date.now(),
        messages: [...messages, { role: 'assistant', content: response.text }],
        addAssistantText: (text: string) => {
          conversation.messages.push({ role: 'assistant', content: text });
        },
        clone: () => ({
          ...conversation,
          id: 'mock-conversation-' + Date.now(),
        }),
      };

      return { conversation, response };
    },

    async followUp(conversationId: string, tools?: any) {
      const response = await this.generateWithTools(
        [{ role: 'user', content: 'Follow up question' }],
        tools || {}
      );

      return {
        conversation: {
          id: conversationId,
          messages: [{ role: 'assistant', content: response.text }],
          addAssistantText: () => {},
          clone: () => ({}),
        },
        response,
      };
    },

    getProvider: () => mock(() => ({ model: 'mock-model' })),

    // Utility methods
    _reset: () => {
      callCount = 0;
    },
    _getCallCount: () => callCount,

    // Convenience methods for common scenarios
    withResponses: (newResponses: MockResponse[]) => {
      responses.splice(0, responses.length, ...newResponses);
      return mockProvider;
    },

    simulateError: (type: 'timeout' | 'api' | 'network' = 'api') => {
      simulateError = true;
      errorType = type;
      return mockProvider;
    },

    withDelay: (ms: number) => {
      delay = ms;
      return mockProvider;
    },
  };

  return mockProvider;
}

/**
 * Predefined mock responses for common scenarios
 */
export const MockResponses = {
  // Planner responses
  createTasks: (
    tasks: Array<{ scenario: string; priority: 'high' | 'medium' | 'low' }>
  ) => ({
    tasks: tasks.map((task) => ({
      toolName: 'createTasks',
      args: { tasks: [task] },
      result: { success: true, tasks: [task] },
    })),
  }),

  // Simple text response
  text: (text: string) => ({ text }),

  // Error response
  error: (message: string) => ({
    simulateError: true,
    text: message,
  }),

  // Tool call without result
  toolCall: (toolName: string, args: any) => ({
    toolCalls: [{ toolName, args }],
    toolResults: [],
  }),

  // Structured object response
  object: (obj: any) => ({
    object: obj,
  }),
};
