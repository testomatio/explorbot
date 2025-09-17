import {
  describe,
  it,
  expect,
  beforeEach,
  mock,
  spyOn,
  afterEach,
} from 'bun:test';
import { Navigator } from '../../src/ai/navigator.js';
import { ActionResult } from '../../src/action-result.js';
import { ConfigParser } from '../../src/config.js';

describe('AI Navigator', () => {
  let navigator: Navigator;
  let mockProvider: any;
  let mockActionResult: ActionResult;
  let mockActor: any;
  let mockStateContext: any;

  beforeEach(() => {
    // Set up test config for ActionResult creation
    ConfigParser.resetForTesting();
    ConfigParser.setupTestConfig();

    mockProvider = {
      chat: mock(() => Promise.resolve({ text: 'AI response' })),
      generateWithTools: mock(() =>
        Promise.resolve({
          text: 'Dynamic tool response',
          toolCalls: [],
        })
      ),
    };

    mockActionResult = new ActionResult({
      html: '<html><body><h1>Test Page</h1></body></html>',
      url: 'https://example.com/test',
      title: 'Test Page',
    });

    mockActor = {
      click: mock(() => Promise.resolve()),
      fillField: mock(() => Promise.resolve()),
      type: mock(() => Promise.resolve()),
      grabCurrentUrl: mock(() =>
        Promise.resolve('https://example.com/current')
      ),
      grabTitle: mock(() => Promise.resolve('Current Page')),
      grabHTMLFrom: mock(() =>
        Promise.resolve('<html><body>Current</body></html>')
      ),
      saveScreenshot: mock(() => Promise.resolve()),
    };

    mockStateContext = {
      state: {
        url: 'https://example.com/test',
        title: 'Test Page',
      },
      knowledge: [],
      experience: [],
      recentTransitions: [],
    };

    navigator = new Navigator(mockProvider);

    // Clear mocks
    mockProvider.chat.mockClear();
    mockProvider.generateWithTools.mockClear();
  });

  afterEach(() => {
    ConfigParser.resetForTesting();
  });

  describe('constructor', () => {
    it('should create navigator with provider', () => {
      expect(navigator).toBeInstanceOf(Navigator);
    });
  });

  describe('resolveState', () => {
    it('should throw error if state is not provided', async () => {
      await expect(
        navigator.resolveState('test message', mockActionResult)
      ).rejects.toThrow('State is required');
    });

    it('should call AI provider with formatted prompt', async () => {
      await navigator.resolveState(
        'test message',
        mockActionResult,
        mockStateContext
      );

      expect(mockProvider.chat).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ role: 'system' }),
          expect.objectContaining({ role: 'user' }),
        ])
      );

      const userMessage = mockProvider.chat.mock.calls[0][0].find(
        (msg: any) => msg.role === 'user'
      );
      expect(userMessage.content).toContain('test message');
      expect(userMessage.content).toContain('https://example.com/test');
    });

    it('should include knowledge in prompt when available', async () => {
      const contextWithKnowledge = {
        ...mockStateContext,
        knowledge: [{ filePath: 'test.md', content: 'Test knowledge content' }],
      };

      await navigator.resolveState(
        'test message',
        mockActionResult,
        contextWithKnowledge
      );

      const userMessage = mockProvider.chat.mock.calls[0][0].find(
        (msg: any) => msg.role === 'user'
      );
      expect(userMessage.content).toContain('Test knowledge content');
    });

    it('should include experience in prompt when available', async () => {
      const contextWithExperience = {
        ...mockStateContext,
        experience: ['Previous experience 1', 'Previous experience 2'],
      };

      await navigator.resolveState(
        'test message',
        mockActionResult,
        contextWithExperience
      );

      const userMessage = mockProvider.chat.mock.calls[0][0].find(
        (msg: any) => msg.role === 'user'
      );
      expect(userMessage.content).toContain('Previous experience 1');
      expect(userMessage.content).toContain('Previous experience 2');
    });

    it('should return AI response', async () => {
      mockProvider.chat.mockResolvedValueOnce({
        text: 'Resolved state response',
      });

      const result = await navigator.resolveState(
        'test message',
        mockActionResult,
        mockStateContext
      );

      expect(result).toBe('Resolved state response');
    });
  });

  describe('changeState', () => {
    it('should throw error if state is not provided', async () => {
      await expect(
        navigator.changeState(
          'test message',
          mockActionResult,
          undefined,
          mockActor
        )
      ).rejects.toThrow('State is required');
    });

    it('should throw error if actor is not provided', async () => {
      await expect(
        navigator.changeState(
          'test message',
          mockActionResult,
          mockStateContext
        )
      ).rejects.toThrow('CodeceptJS actor is required for changeState');
    });

    it('should create tools with actor', async () => {
      await navigator.changeState(
        'test message',
        mockActionResult,
        mockStateContext,
        mockActor
      );

      // Verify generateWithTools was called (which means tools were created)
      expect(mockProvider.generateWithTools).toHaveBeenCalled();
    });

    it('should call generateWithTools with correct parameters', async () => {
      await navigator.changeState(
        'test message',
        mockActionResult,
        mockStateContext,
        mockActor
      );

      expect(mockProvider.generateWithTools).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ role: 'system' }),
          expect.objectContaining({ role: 'user' }),
        ]),
        expect.objectContaining({
          click: expect.any(Object),
          type: expect.any(Object),
        }),
        { maxToolRoundtrips: 5 }
      );
    });

    it('should include user message and page state in prompt', async () => {
      await navigator.changeState(
        'create a ticket',
        mockActionResult,
        mockStateContext,
        mockActor
      );

      const userMessage = mockProvider.generateWithTools.mock.calls[0][0].find(
        (msg: any) => msg.role === 'user'
      );
      expect(userMessage.content).toContain('create a ticket');
      expect(userMessage.content).toContain('https://example.com/test');
      expect(userMessage.content).toContain('Test Page');
    });

    it('should capture final page state', async () => {
      const result = await navigator.changeState(
        'test message',
        mockActionResult,
        mockStateContext,
        mockActor
      );

      expect(mockActor.grabCurrentUrl).toHaveBeenCalled();
      expect(mockActor.grabTitle).toHaveBeenCalled();
      expect(mockActor.grabHTMLFrom).toHaveBeenCalledWith('body');
      expect(result).toBeInstanceOf(ActionResult);
    });

    it('should handle generateWithTools errors gracefully', async () => {
      mockProvider.generateWithTools.mockRejectedValueOnce(
        new Error('AI Error')
      );

      const result = await navigator.changeState(
        'test message',
        mockActionResult,
        mockStateContext,
        mockActor
      );

      // Should still return a result (fallback page state)
      expect(result).toBeInstanceOf(ActionResult);
      expect(mockActor.grabCurrentUrl).toHaveBeenCalled();
    });

    it('should validate task completion', async () => {
      mockProvider.generateWithTools.mockResolvedValueOnce({
        text: 'Task completed',
        toolCalls: [],
      });

      // Mock task validation to return true
      const mockIsTaskCompleted = spyOn(
        navigator as any,
        'isTaskCompleted'
      ).mockResolvedValue(true);

      const result = await navigator.changeState(
        'test task',
        mockActionResult,
        mockStateContext,
        mockActor
      );

      expect(mockIsTaskCompleted).toHaveBeenCalledWith(
        'test task',
        expect.any(ActionResult)
      );
    });
  });

  describe('private methods', () => {
    describe('capturePageState', () => {
      it('should capture current page state from actor', async () => {
        const capturePageState = (navigator as any).capturePageState;

        const result = await capturePageState.call(navigator, mockActor);

        expect(mockActor.grabCurrentUrl).toHaveBeenCalled();
        expect(mockActor.grabTitle).toHaveBeenCalled();
        expect(mockActor.grabHTMLFrom).toHaveBeenCalledWith('body');
        expect(result).toBeInstanceOf(ActionResult);
        expect(result.url).toBe('https://example.com/current');
        expect(result.title).toBe('Current Page');
      });

      it('should handle page state capture errors', async () => {
        const capturePageState = (navigator as any).capturePageState;
        mockActor.grabCurrentUrl.mockRejectedValueOnce(
          new Error('Grab failed')
        );

        await expect(
          capturePageState.call(navigator, mockActor)
        ).rejects.toThrow('Failed to capture page state');
      });

      it('should handle screenshot capture errors gracefully', async () => {
        const capturePageState = (navigator as any).capturePageState;
        mockActor.saveScreenshot.mockRejectedValueOnce(
          new Error('Screenshot failed')
        );

        const result = await capturePageState.call(navigator, mockActor);

        expect(result).toBeInstanceOf(ActionResult);
        // Should still succeed even if screenshot fails
      });
    });

    describe('isTaskCompleted', () => {
      it('should use AI to validate task completion', async () => {
        const isTaskCompleted = (navigator as any).isTaskCompleted;
        mockProvider.chat.mockResolvedValueOnce({
          text: 'yes, the task is completed',
        });

        const result = await isTaskCompleted.call(
          navigator,
          'create ticket',
          mockActionResult
        );

        expect(mockProvider.chat).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({ role: 'system' }),
            expect.objectContaining({ role: 'user' }),
          ])
        );
        expect(result).toBe(true);
      });

      it('should return false for negative AI response', async () => {
        const isTaskCompleted = (navigator as any).isTaskCompleted;
        mockProvider.chat.mockResolvedValueOnce({
          text: 'no, the task is not completed yet',
        });

        const result = await isTaskCompleted.call(
          navigator,
          'create ticket',
          mockActionResult
        );

        expect(result).toBe(false);
      });

      it('should handle AI validation errors gracefully', async () => {
        const isTaskCompleted = (navigator as any).isTaskCompleted;
        mockProvider.chat.mockRejectedValueOnce(
          new Error('AI validation failed')
        );

        const result = await isTaskCompleted.call(
          navigator,
          'create ticket',
          mockActionResult
        );

        // Should return false (conservative approach) on error
        expect(result).toBe(false);
      });
    });
  });
});
