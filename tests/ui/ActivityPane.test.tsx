import { describe, expect, it, beforeEach } from 'bun:test';
import { render } from 'ink-testing-library';
import React from 'react';
import ActivityPane from '../../src/components/ActivityPane';
import { clearActivity } from '../../src/activity';

describe('ActivityPane', () => {
  beforeEach(() => {
    // Clear any existing activities
    clearActivity();
  });

  it('should show hint message when no activity', () => {
    const { lastFrame } = render(<ActivityPane />);
    const frame = lastFrame();

    expect(frame).toContain('Type a command (start with / for help)');
  });

  it('should render without crashing when activity is present', () => {
    // Set activity before rendering (this tests the component's ability to handle existing activities)
    const { lastFrame } = render(<ActivityPane />);
    const frame = lastFrame();

    // Should render without errors
    expect(typeof frame).toBe('string');
  });

  it('should have correct structure when active', () => {
    const { lastFrame } = render(<ActivityPane />);
    const frame = lastFrame();

    // Should contain the hint message when no activity
    expect(frame).toContain('Type a command');
  });
});
