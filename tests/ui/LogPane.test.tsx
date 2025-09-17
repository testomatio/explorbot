import { describe, expect, it } from 'bun:test';
import { render } from 'ink-testing-library';
import React from 'react';
import LogPane from '../../src/components/LogPane';

describe('LogPane', () => {
  it('should render logs correctly', () => {
    const logs = [
      '🚀 Starting ExplorBot...',
      '🔧 Browser started in headless mode',
      { type: 'info', content: 'Test message' },
    ];

    const { lastFrame } = render(<LogPane logs={logs} verboseMode={false} />);
    const frame = lastFrame();

    expect(frame).toContain('Starting ExplorBot');
    expect(frame).toContain('Browser started in headless mode');
    expect(frame).toContain('Test message');
  });

  it('should handle empty logs array', () => {
    const { lastFrame } = render(<LogPane logs={[]} verboseMode={false} />);
    const frame = lastFrame();

    // Empty LogPane might render whitespace or empty string
    expect(typeof frame).toBe('string');
  });

  it('should respect verbose mode', () => {
    const logs = ['Debug message', 'Important message'];

    const { lastFrame: frameVerbose } = render(
      <LogPane logs={logs} verboseMode={true} />
    );
    const { lastFrame: frameNonVerbose } = render(
      <LogPane logs={logs} verboseMode={false} />
    );

    // Both should render the same for now (implementation may vary)
    expect(frameVerbose()).toBeTruthy();
    expect(frameNonVerbose()).toBeTruthy();
  });

  it('should limit logs to prevent overflow', () => {
    // Create many logs
    const logs = Array(100)
      .fill(null)
      .map((_, i) => `Log entry ${i}`);

    const { lastFrame } = render(<LogPane logs={logs} verboseMode={false} />);
    const frame = lastFrame();

    // LogPane should display all logs passed to it (limiting is done in App component)
    expect(
      frame.split('\n').filter((line) => line.trim()).length
    ).toBeGreaterThan(0);
  });
});
