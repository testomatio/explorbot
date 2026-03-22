import { MockLanguageModelV3 } from 'ai/test';

export interface MockAIResponse {
  text?: string;
  toolCalls?: Array<{
    toolCallId: string;
    toolName: string;
    args: Record<string, any>;
  }>;
  object?: any;
}

export class MockAIProvider {
  private responses: MockAIResponse[] = [];
  private responseIndex = 0;
  private model: MockLanguageModelV3;
  private shouldFail = false;
  private failureCount = 0;
  public callHistory: string[] = [];
  public lastMessages: any[] = [];

  constructor() {
    this.model = new MockLanguageModelV3({
      provider: 'test',
      modelId: 'test-model',
      doGenerate: async (params) => {
        const messages = (params as any)?.messages || [];
        this.lastMessages = messages;
        this.callHistory.push(JSON.stringify(messages));

        if (this.shouldFail && this.failureCount > 0) {
          this.failureCount--;
          const error = new Error('AI_APICallError: Simulated API error');
          error.name = 'AI_APICallError';
          throw error;
        }

        const response = this.getNextResponse();

        return {
          text: response.text || 'Mock AI response',
          toolCalls: response.toolCalls || [],
          finishReason: 'stop' as const,
          usage: { inputTokens: 10, outputTokens: 20 },
          content: [{ type: 'text' as const, text: response.text || 'Mock AI response' }],
        };
      },
    });
  }

  setResponses(responses: MockAIResponse[]) {
    this.responses = responses;
    this.responseIndex = 0;
  }

  addResponse(response: MockAIResponse) {
    this.responses.push(response);
  }

  setFailure(shouldFail: boolean, count = 1) {
    this.shouldFail = shouldFail;
    this.failureCount = count;
  }

  private getNextResponse(): MockAIResponse {
    if (this.responses.length === 0) {
      return { text: 'Default mock response' };
    }

    const response = this.responses[this.responseIndex];
    this.responseIndex = (this.responseIndex + 1) % this.responses.length;
    return response;
  }

  getModel() {
    return this.model;
  }

  reset() {
    this.responses = [];
    this.responseIndex = 0;
    this.callHistory = [];
    this.lastMessages = [];
    this.shouldFail = false;
    this.failureCount = 0;
  }

  getCallCount(): number {
    return this.callHistory.length;
  }

  getLastCall(): string | null {
    return this.callHistory[this.callHistory.length - 1] || null;
  }
}
