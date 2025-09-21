import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { Planner } from '../../src/ai/planner.js';
import { Provider } from '../../src/ai/provider.js';
import type { StateManager } from '../../src/state-manager.js';
import { Conversation } from '../../src/ai/conversation.js';

// Create a mock provider that simulates AI responses
const createMockProvider = (responses: any[]) => {
  let callCount = 0;
  return {
    generateWithTools: mock(async (messages, tools, options) => {
      const response = responses[callCount] || responses[responses.length - 1];
      callCount++;

      // Simulate tool call response
      return {
        text: response.text || 'Mocked AI response',
        toolCalls: [
          {
            toolName: 'createTasks',
            args: response.toolArgs || { tasks: [] },
          },
        ],
        toolResults: [
          {
            toolName: 'createTasks',
            result: {
              success: true,
              tasks: response.tasks || [],
            },
          },
        ],
      };
    }),

    getProvider: () => mock(() => ({ model: 'mock-model' })),

    // Reset call count
    _reset: () => {
      callCount = 0;
    },
  };
};

describe('Planner with Mock Provider', () => {
  let planner: Planner;
  let mockProvider: any;
  let mockStateManager: StateManager;

  beforeEach(() => {
    // Create mock responses
    const mockResponses = [
      {
        tasks: [
          { scenario: 'Test user login functionality', priority: 'high' },
          { scenario: 'Test password reset flow', priority: 'medium' },
          { scenario: 'Test social media login options', priority: 'low' },
        ],
      },
    ];

    mockProvider = createMockProvider(mockResponses);
    mockStateManager = {
      getCurrentState: () => ({
        url: 'https://example.com/login',
        title: 'Login Page',
        html: '<html><body><form>Login form</form></body></html>',
      }),
      getExperienceTracker: () => ({}),
    } as StateManager;

    planner = new Planner(mockProvider, mockStateManager);
  });

  it('should create tasks with priorities using mock provider', async () => {
    const conversation = new Conversation([
      { role: 'user', content: 'Analyze this page' },
    ]);

    const tasks = await planner.plan(conversation);

    expect(tasks).toHaveLength(3);
    expect(tasks[0].scenario).toBe('Test user login functionality');
    expect(tasks[0].priority).toBe('high');
    expect(tasks[1].priority).toBe('medium');
    expect(tasks[2].priority).toBe('low');
    expect(mockProvider.generateWithTools).toHaveBeenCalled();
  });

  it('should sort tasks by priority', async () => {
    // Create response with mixed priorities
    const mockResponses = [
      {
        tasks: [
          { scenario: 'Low priority task', priority: 'low' },
          { scenario: 'High priority task', priority: 'high' },
          { scenario: 'Medium priority task', priority: 'medium' },
        ],
      },
    ];

    mockProvider = createMockProvider(mockResponses);
    planner = new Planner(mockProvider, mockStateManager);

    const conversation = new Conversation([
      { role: 'user', content: 'Analyze this page' },
    ]);

    const tasks = await planner.plan(conversation);

    // Should be sorted: high, medium, low
    expect(tasks[0].priority).toBe('high');
    expect(tasks[1].priority).toBe('medium');
    expect(tasks[2].priority).toBe('low');
  });

  it('should handle tool call failures gracefully', async () => {
    const mockProviderWithError = {
      generateWithTools: mock(async () => {
        return {
          text: 'No tool calls made',
          toolResults: [],
        };
      }),
      getProvider: () => mock(() => ({ model: 'mock-model' })),
    };

    planner = new Planner(mockProviderWithError, mockStateManager);
    const conversation = new Conversation([
      { role: 'user', content: 'Analyze this page' },
    ]);

    await expect(planner.plan(conversation)).rejects.toThrow(
      'Failed to get planning response - no tool calls made'
    );
  });
});
