import { MockLanguageModelV2 } from 'ai/test';

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
  private model: MockLanguageModelV2;
  public callHistory: string[] = [];
  public lastMessages: any[] = [];

  constructor() {
    this.model = new MockLanguageModelV2({
      generateTextResponse: async ({ prompt, messages }) => {
        this.lastMessages = messages || [];
        this.callHistory.push(JSON.stringify(messages || prompt));
        
        const response = this.getNextResponse();
        
        return {
          text: response.text || 'Mock AI response',
          toolCalls: response.toolCalls || [],
          finishReason: 'stop' as const,
          usage: {
            promptTokens: 10,
            completionTokens: 20,
          },
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

  getProvider() {
    return () => this.model;
  }

  reset() {
    this.responses = [];
    this.responseIndex = 0;
    this.callHistory = [];
    this.lastMessages = [];
  }

  getCallCount(): number {
    return this.callHistory.length;
  }

  getLastCall(): string | null {
    return this.callHistory[this.callHistory.length - 1] || null;
  }
}