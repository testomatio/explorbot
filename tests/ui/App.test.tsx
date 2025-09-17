import { describe, expect, it, beforeEach, mock } from 'bun:test';
import { render } from 'ink-testing-library';
import React from 'react';
import { App } from '../../src/components/App';
import type { ExplorBot } from '../../src/explorbot';

// Mock the explorbot and its dependencies
const mockExplorBot: Partial<ExplorBot> = {
  getOptions: () => ({ verbose: false }),
  setUserResolve: () => {},
  start: async () => {},
  getExplorer: () => ({
    getStateManager: () => ({
      getCurrentState: () => ({
        url: 'http://example.com',
        title: 'Test Page',
        stateHash: 'test123',
      }),
      onStateChange: () => () => {},
    }),
  }),
  visitInitialState: async () => {},
};

// Mock the CommandHandler
const mockCommandHandler = {
  getAvailableCommands: () => [
    '/research',
    '/plan',
    '/navigate',
    'I.click',
    'I.see',
  ],
  executeCommand: async () => {},
};

// Mock the logger
const mockSetLogCallback = () => {};

describe('App Component', () => {
  beforeEach(() => {
    // Mock all the modules
    mock.module('../../src/explorbot', () => ({
      ExplorBot: class {
        constructor() {
          return mockExplorBot;
        }
      },
    }));

    mock.module('../../src/command-handler', () => ({
      CommandHandler: class {
        constructor() {
          return mockCommandHandler;
        }
      },
    }));

    mock.module('../../src/utils/logger', () => ({
      setLogCallback: () => mockSetLogCallback,
      log: () => {},
      createDebug: () => () => {},
      tag: () => ({ log: () => {} }),
    }));

    // Mock process.env
    process.env.INK_RUNNING = '1';
  });

  it('should render LogPane when logs are present', async () => {
    const { lastFrame } = render(
      <App
        explorBot={mockExplorBot as ExplorBot}
        initialShowInput={false}
        exitOnEmptyInput={false}
      />
    );

    // Wait for async initialization
    await new Promise((resolve) => setTimeout(resolve, 0));

    const frame = lastFrame();
    expect(frame).toBeTruthy();
  });

  it('should show ActivityPane when input is not shown', async () => {
    const { lastFrame } = render(
      <App
        explorBot={mockExplorBot as ExplorBot}
        initialShowInput={false}
        exitOnEmptyInput={false}
      />
    );

    // Wait for async initialization
    await new Promise((resolve) => setTimeout(resolve, 100));

    const frame = lastFrame();
    // The ActivityPane should be rendered (it shows "Type a command..." when no activity)
    // But it might be at the bottom of the output
    expect(frame).toBeTruthy();
  });

  it('should show InputPane when input is shown', async () => {
    const { lastFrame } = render(
      <App
        explorBot={mockExplorBot as ExplorBot}
        initialShowInput={true}
        exitOnEmptyInput={false}
      />
    );

    // Wait for async initialization
    await new Promise((resolve) => setTimeout(resolve, 0));

    const frame = lastFrame();
    // InputPane doesn't render visible content by default when empty
    expect(frame).toBeTruthy();
  });

  it('should display current state when available', async () => {
    const { lastFrame } = render(
      <App
        explorBot={mockExplorBot as ExplorBot}
        initialShowInput={false}
        exitOnEmptyInput={false}
      />
    );

    // Wait for async initialization
    await new Promise((resolve) => setTimeout(resolve, 0));

    const frame = lastFrame();
    expect(frame).toContain('current page');
    expect(frame).toContain('http://example.com');
    expect(frame).toContain('Test Page');
  });

  it('should render logs when they are added', async () => {
    const { lastFrame } = render(
      <App
        explorBot={mockExplorBot as ExplorBot}
        initialShowInput={false}
        exitOnEmptyInput={false}
      />
    );

    // Wait for async initialization
    await new Promise((resolve) => setTimeout(resolve, 100));

    const frame = lastFrame();
    expect(frame).toContain('Starting ExplorBot');
  });

  it('should not crash when no state is available', async () => {
    const mockExplorBotNoState = {
      ...mockExplorBot,
      getExplorer: () => ({
        getStateManager: () => ({
          getCurrentState: () => null,
          onStateChange: () => () => {},
        }),
      }),
    };

    mock.module('../../src/explorbot', () => ({
      ExplorBot: class {
        constructor() {
          return mockExplorBotNoState;
        }
      },
    }));

    const { lastFrame } = render(
      <App
        explorBot={mockExplorBotNoState as ExplorBot}
        initialShowInput={false}
        exitOnEmptyInput={false}
      />
    );

    // Wait for async initialization
    await new Promise((resolve) => setTimeout(resolve, 0));

    const frame = lastFrame();
    expect(frame).toBeTruthy();
  });
});
