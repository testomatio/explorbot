import { describe, expect, it } from 'bun:test';
import { drillLocatorRule, locatorRule } from '../../src/ai/rules.ts';

describe('locator rules', () => {
  it('keeps context simplification in the general rule only', () => {
    expect(locatorRule).toContain('<context_simplification>');
    expect(drillLocatorRule).not.toContain('<context_simplification>');
    expect(drillLocatorRule).toContain('<locator_priority>');
    expect(drillLocatorRule).toContain('<disambiguation>');
    expect(drillLocatorRule).toContain('<xpath_rules>');
  });
});
