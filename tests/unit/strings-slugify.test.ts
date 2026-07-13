import { describe, expect, it } from 'bun:test';
import { ActionResult } from '../../src/action-result.ts';
import { slugify } from '../../src/utils/strings.ts';

describe('slugify', () => {
  it('sanitizes a URL path with query into an underscore slug', () => {
    expect(slugify('/users/42?tab=info')).toBe('users_42_tab_info');
  });

  it('replaces unicode and punctuation and collapses separators', () => {
    expect(slugify('Café — Menu!')).toBe('caf_menu');
  });

  it('trims leading and trailing separators', () => {
    expect(slugify('  Hello World  ')).toBe('hello_world');
    expect(slugify('--hello--world--')).toBe('hello_world');
  });

  it('leaves an already-clean slug unchanged', () => {
    expect(slugify('already_clean_slug')).toBe('already_clean_slug');
  });

  it('keeps ActionResult.getStateHash stable (disk file names must not change)', () => {
    const result = new ActionResult({ url: 'https://example.com/admin/users', html: '<h1>User List</h1>' });
    expect(result.getStateHash()).toBe('admin_users_h1_user_list');
  });
});
