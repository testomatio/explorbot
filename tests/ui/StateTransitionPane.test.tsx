import { describe, expect, it } from 'bun:test';
import { render } from 'ink-testing-library';
import React from 'react';
import StateTransitionPane from '../../src/components/StateTransitionPane';

describe('StateTransitionPane', () => {
  it('should display current state information', () => {
    const currentState = {
      url: 'https://example.com/users',
      title: 'User Management',
      stateHash: 'abc123',
      elements: ['button', 'input'],
      screenshot: 'screenshot.png',
      timestamp: new Date(),
    };

    const { lastFrame } = render(
      <StateTransitionPane currentState={currentState} />
    );
    const frame = lastFrame();

    expect(frame).toContain('current page');
    expect(frame).toContain('https://example.com/users');
    expect(frame).toContain('User Management');
  });

  it('should handle missing state gracefully', () => {
    const { lastFrame } = render(<StateTransitionPane currentState={null} />);
    const frame = lastFrame();

    // Component returns null when no state
    expect(frame).toBe('');
  });

  it('should display timestamp', () => {
    const currentState = {
      url: 'https://example.com',
      title: 'Test',
      stateHash: 'test123',
      elements: [],
      screenshot: '',
      timestamp: new Date('2024-01-01T12:00:00'),
    };

    const { lastFrame } = render(
      <StateTransitionPane currentState={currentState} />
    );
    const frame = lastFrame();

    expect(frame).toMatch(/\d{2}:\d{2}:\d{2}/); // Should contain time
  });

  it('should format long URLs appropriately', () => {
    const longUrl =
      'https://example.com/very/long/path/that/should/be/truncated/to/fit/in/the/terminal';
    const currentState = {
      url: longUrl,
      title: 'Test Page',
      stateHash: 'test123',
      elements: [],
      screenshot: '',
      timestamp: new Date(),
    };

    const { lastFrame } = render(
      <StateTransitionPane currentState={currentState} />
    );
    const frame = lastFrame();

    // URL should be present but may be truncated
    expect(frame).toContain('example.com');
  });
});
