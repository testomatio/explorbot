import { describe, expect, it } from 'bun:test';
import { Box } from 'ink';
import { render } from 'ink-testing-library';
import React from 'react';
import Autocomplete from '../../src/components/Autocomplete.js';
import { setAutocompleteState } from '../../src/components/autocomplete-store.js';

function show(displays: string[], selectedIndex = 0): string {
  setAutocompleteState({
    visible: true,
    selectedIndex,
    suggestions: displays.map((display) => ({ value: display, display, description: '' })),
  });
  const { lastFrame } = render(
    <Box height={7} width={120}>
      <Autocomplete />
    </Box>
  );
  return lastFrame() || '';
}

describe('Autocomplete pane', () => {
  it('puts wide suggestions on their own line', () => {
    const plans = ['users_sign_in.md            /users/sign_in     6 tests', 'projects_zephyr_runs.md     /projects/zephyr   4 tests'];

    const lines = show(plans)
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    expect(lines).toEqual(plans.map((plan) => plan.trim()));
  });

  it('keeps short suggestions side by side', () => {
    const frame = show(['/test', '/plan', '/navigate', '/research', '/drill', '/rerun']);

    expect(frame).toContain('/test');
    expect(frame.split('\n').some((line) => line.includes('/test') && line.includes('/rerun'))).toBe(true);
  });

  it('scrolls wide suggestions so the selected one stays visible', () => {
    const plans = [
      'first_plan.md                  /first          1 test',
      'second_plan.md                 /second         2 tests',
      'third_plan.md                  /third          3 tests',
      'fourth_plan.md                 /fourth         4 tests',
      'fifth_plan.md                  /fifth          5 tests',
      'sixth_plan.md                  /sixth          6 tests',
    ];

    const frame = show(plans, 5);

    expect(frame).toContain('sixth_plan.md');
    expect(frame).not.toContain('first_plan.md');
  });
});
