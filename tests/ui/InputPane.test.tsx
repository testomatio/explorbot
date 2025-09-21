import { describe, expect, it, beforeEach, mock } from 'bun:test';
import { render } from 'ink-testing-library';
import React from 'react';
import InputPane from '../../src/components/InputPane';
import { CommandHandler } from '../../src/command-handler';
import type { ExplorBot } from '../../src/explorbot';

describe('InputPane', () => {
  let commandHandler: CommandHandler;

  beforeEach(() => {
    // Create a mock explorBot for testing
    const mockExplorBot: Partial<ExplorBot> = {
      getOptions: () => ({ verbose: false }),
      getExplorer: () => ({
        visit: async () => {},
        research: async () => {},
        plan: async () => {},
        navigate: async () => {},
        createAction: () => ({
          execute: async () => {},
        }),
      }),
    };

    commandHandler = new CommandHandler(mockExplorBot as ExplorBot);
  });

  it('should render input pane', () => {
    const { lastFrame } = render(
      <InputPane commandHandler={commandHandler} exitOnEmptyInput={false} />
    );
    const frame = lastFrame();

    expect(frame).toContain('>');
  });

  it('should handle exit on empty input when enabled', () => {
    // Mock process.exit to prevent actual exit during tests
    const originalExit = process.exit;
    const exitSpy = mock(() => {});

    // @ts-ignore - Mocking process.exit
    process.exit = exitSpy;

    const { lastFrame } = render(
      <InputPane commandHandler={commandHandler} exitOnEmptyInput={true} />
    );
    const frame = lastFrame();

    expect(frame).toContain('>');

    // Restore original process.exit
    process.exit = originalExit;
  });

  it('should render with custom submit handler', () => {
    const mockSubmit = mock(async () => {});

    const { lastFrame } = render(
      <InputPane
        commandHandler={commandHandler}
        exitOnEmptyInput={false}
        onSubmit={mockSubmit}
      />
    );
    const frame = lastFrame();

    expect(frame).toContain('>');
  });

  it('should integrate with command handler', () => {
    const { lastFrame } = render(
      <InputPane commandHandler={commandHandler} exitOnEmptyInput={false} />
    );
    const frame = lastFrame();

    expect(frame).toBeTruthy();
  });
});
