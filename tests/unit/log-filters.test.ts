import { describe, expect, test } from 'bun:test';
import { RecentStepFilter } from '../../src/utils/log-filters.ts';

describe('log filters', () => {
  test('deduplicates repeated identical step commands within ttl', () => {
    const filter = new RecentStepFilter(15000);
    expect(filter.shouldSuppress('I.fillField("Search", "query")', 1000)).toBe(false);
    expect(filter.shouldSuppress('I.fillField("Search", "query")', 2000)).toBe(true);
    expect(filter.shouldSuppress('I.click("Save", "toolbar")', 3000)).toBe(false);
    expect(filter.shouldSuppress('I.click("Save", "toolbar")', 4000)).toBe(true);
  });

  test('keeps different locator variants visible', () => {
    const filter = new RecentStepFilter(15000);
    expect(filter.shouldSuppress('I.fillField("Search", "query")', 1000)).toBe(false);
    expect(filter.shouldSuppress('I.fillField("role":"textbox","text":"Search", "query", "toolbar")', 2000)).toBe(false);
    expect(filter.shouldSuppress('I.click("Save", "toolbar")', 3000)).toBe(false);
    expect(filter.shouldSuppress('I.click("button.primary type="submit"", "toolbar")', 4000)).toBe(false);
  });

  test('allows repeated actions after ttl expires', () => {
    const filter = new RecentStepFilter(15000);
    expect(filter.shouldSuppress('I.click("Save")', 1000)).toBe(false);
    expect(filter.shouldSuppress('I.click("Save")', 17000)).toBe(false);
  });
});
