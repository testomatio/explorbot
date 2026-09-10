import { describe, expect, it } from 'bun:test';
import type { PageDiff } from '../../src/action-result.ts';
import { isMajorPageChange } from '../../src/ai/tools.ts';

const diff = (over: Partial<PageDiff>): PageDiff => ({ urlChanged: false, currentUrl: '/list', ...over }) as PageDiff;

describe('isMajorPageChange', () => {
  it('treats a large batch of pure additions as growth', () => {
    expect(isMajorPageChange(diff({ ariaChangeCount: 120, ariaAdded: 120, ariaRemoved: 0 }))).toBe(false);
  });

  it('still flags a churning diff as a mode change', () => {
    expect(isMajorPageChange(diff({ ariaChangeCount: 120, ariaAdded: 60, ariaRemoved: 60 }))).toBe(true);
  });

  it('ignores a small diff either way', () => {
    expect(isMajorPageChange(diff({ ariaChangeCount: 4, ariaAdded: 2, ariaRemoved: 2 }))).toBe(false);
  });

  it('falls back to the total when the split is absent', () => {
    expect(isMajorPageChange(diff({ ariaChangeCount: 120 }))).toBe(true);
  });

  it('is never a mode change when the URL changed', () => {
    expect(isMajorPageChange(diff({ urlChanged: true, ariaChangeCount: 120, ariaAdded: 60, ariaRemoved: 60 }))).toBe(false);
  });
});
