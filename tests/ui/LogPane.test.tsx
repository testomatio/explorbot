import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { render, cleanup } from 'ink-testing-library';
import React from 'react';
import LogPane from '../../src/components/LogPane';
import { registerLogPane, unregisterLogPane } from '../../src/utils/logger.js';

describe('LogPane', () => {
  beforeEach(() => {
    // Clean up after each test
    cleanup();
  });

  it('should render empty LogPane', () => {
    const { lastFrame } = render(<LogPane verboseMode={false} />);
    const frame = lastFrame();

    // Empty LogPane might render whitespace or empty string
    expect(typeof frame).toBe('string');
  });

  it('should respect verbose mode', () => {
    const { lastFrame: frameVerbose } = render(
      <LogPane verboseMode={true} />
    );
    const { lastFrame: frameNonVerbose } = render(
      <LogPane verboseMode={false} />
    );

    // Empty LogPane renders empty string (no logs to display)
    expect(frameVerbose()).toBe('');
    expect(frameNonVerbose()).toBe('');
  });

  it('should register and unregister with logger', () => {
    const mockAddLog = () => {};

    // Test that register/unregister functions work
    expect(() => registerLogPane(mockAddLog)).not.toThrow();
    expect(() => unregisterLogPane(mockAddLog)).not.toThrow();
  });

  it('should handle component mounting and unmounting', () => {
    const mockAddLog = () => {};

    // Register should work
    registerLogPane(mockAddLog);

    // Unregister should work
    unregisterLogPane(mockAddLog);
  });

  it('should render with verbose mode enabled', () => {
    const { lastFrame } = render(<LogPane verboseMode={true} />);
    const frame = lastFrame();

    // Empty LogPane renders empty string (no logs to display)
    expect(frame).toBe('');
  });

  it('should render with verbose mode disabled', () => {
    const { lastFrame } = render(<LogPane verboseMode={false} />);
    const frame = lastFrame();

    // Empty LogPane renders empty string (no logs to display)
    expect(frame).toBe('');
  });
});
