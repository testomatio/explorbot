import { describe, expect, it } from 'bun:test';
import { DocBot } from '../../boat/doc-collector/src/docbot.ts';
import { Documentarian } from '../../boat/doc-collector/src/ai/documentarian.ts';
import { normalizeAction, renderPageDocumentation, renderSpecIndex } from '../../boat/doc-collector/src/docs-renderer.ts';
import { getDocPageKey, shouldCrawlDocPath } from '../../boat/doc-collector/src/path-filter.ts';
import { extractResearchNavigationTargets } from '../../boat/doc-collector/src/research-navigation.ts';

describe('doc-collector path filter', () => {
  it('allows regular documentation pages', () => {
    expect(shouldCrawlDocPath('/users/sign_in')).toBe(true);
    expect(shouldCrawlDocPath('/users/sign_up')).toBe(true);
    expect(shouldCrawlDocPath('/users/password/new')).toBe(true);
    expect(shouldCrawlDocPath('/users/sso')).toBe(true);
    expect(shouldCrawlDocPath('/users/auth/google_oauth2')).toBe(true);
  });

  it('skips callback and destructive endpoints', () => {
    expect(shouldCrawlDocPath('/users/auth/github/callback')).toBe(false);
    expect(shouldCrawlDocPath('/logout')).toBe(false);
  });

  it('supports config-driven include and exclude path policies', () => {
    expect(
      shouldCrawlDocPath('/admin/users', {
        docs: {
          excludePaths: ['/admin/*'],
        },
      })
    ).toBe(false);

    expect(
      shouldCrawlDocPath('/admin/users', {
        docs: {
          includePaths: ['/admin/*'],
        },
      })
    ).toBe(true);
  });

  it('generalizes dynamic pages into one crawl key by default', () => {
    expect(getDocPageKey('/users/123')).toBe(getDocPageKey('/users/456'));
    expect(getDocPageKey('/users/123/edit')).toBe(getDocPageKey('/users/456/edit'));
  });

  it('can keep dynamic pages separate when configured', () => {
    expect(
      getDocPageKey('/users/123', {
        docs: {
          collapseDynamicPages: false,
        },
      })
    ).toBe('users/123');
  });
});

describe('doc-collector research navigation', () => {
  it('extracts openapi tag targets from navigation and menu sections', () => {
    const research = `
## Navigation

| Element | Type | ARIA | CSS |
|------|------|------|------|
| 'Project / Analytics / Tags' | button | { role: 'button', text: 'Project / Analytics / Tags Open Group' } | 'button[id="api-1/tag/project-analytics-tags"]' |
| 'Project / Analytics / Labels' | button | { role: 'button', text: 'Project / Analytics / Labels Open Group' } | 'button:has-text("Project / Analytics / Labels")' |
| 'Shows linked issues from jira statistics for a project' | button | { role: 'button', text: 'Shows linked issues from jira statistics for a project' } | 'button:has-text("Shows linked issues")' |

## Menu

| Element | Type | ARIA | CSS |
|------|------|------|------|
| 'Show More' | button | { role: 'button', text: 'Show all Project / Analytics / Jira endpoints' } | 'button[id="api-1/tag/project-analytics-jira"]' |
`;

    expect(
      extractResearchNavigationTargets(
        {
          url: '/docs/openapi#tag/project-analytics-tests',
        },
        research
      )
    ).toEqual([
      '/docs/openapi#tag/project-analytics-tags',
      '/docs/openapi#tag/project-analytics-labels',
      '/docs/openapi#tag/project-analytics-jira',
    ]);
  });
});

describe('doc-collector renderer', () => {
  it('renders page documentation in spec format', () => {
    const markdown = renderPageDocumentation(
      {
        url: '/users/sign_in',
        title: 'Testomat.io',
      },
      {
        summary: 'Sign in page for existing users',
        can: [
          {
            action: 'user can sign in with email and password',
            scope: 'page-level',
            evidence: 'Email and password fields plus submit button are visible',
          },
        ],
        might: [
          {
            action: 'use social login',
            scope: 'one item',
            evidence: 'OAuth buttons are shown in the form',
          },
        ],
      }
    );

    expect(markdown).toContain('## Purpose');
    expect(markdown).toContain('- user can sign in with email and password -> page-level');
    expect(markdown).toContain('Proof: Email and password fields plus submit button are visible.');
    expect(markdown).toContain('- user might use social login -> one item');
    expect(markdown).toContain('Signal: OAuth buttons are shown in the form.');
  });

  it('renders aggregate spec index with skipped pages', () => {
    const markdown = renderSpecIndex(
      'D:/project/output/docs',
      '/users/sign_in',
      [
        {
          url: '/users/sign_in',
          title: 'Testomat.io',
          summary: 'Sign in page',
          canCount: 7,
          mightCount: 1,
          canActions: ['user can sign in with email and password'],
          mightActions: ['user might use social login'],
          filePath: 'D:/project/output/docs/pages/users_sign_in.md',
        },
      ],
      [
        {
          url: '/users/auth/google_oauth2',
          reason: 'redirected into external auth flow',
        },
      ],
      20
    );

    expect(markdown).toContain('## Overview');
    expect(markdown).toContain('### [/users/sign_in](pages/users_sign_in.md)');
    expect(markdown).toContain('Proven actions: 7');
    expect(markdown).toContain('User Can:');
    expect(markdown).toContain('- user can sign in with email and password');
    expect(markdown).toContain('User Might:');
    expect(markdown).toContain('- user might use social login');
    expect(markdown).toContain('## Skipped');
    expect(markdown).toContain('/users/auth/google_oauth2. Reason: redirected into external auth flow.');
  });

  it('normalizes might-actions without duplicating prefixes', () => {
    expect(normalizeAction('user might be able to submit the login form by pressing Enter', 'might')).toBe('user might be able to submit the login form by pressing Enter');
    expect(normalizeAction('user can submit the login form by pressing Enter', 'might')).toBe('user might submit the login form by pressing Enter');
  });

});

describe('doc-collector scope and signal', () => {
  it('keeps subtree scope around the start page', () => {
    const bot = new DocBot();
    (bot as any).config = { docs: { scope: 'subtree' } };
    (bot as any).scopeRoot = '/ua/serials/stb/kod';

    expect((bot as any).isInScope('/ua/serials/stb/kod/2026')).toBe(true);
    expect((bot as any).isInScope('/ua/serials/stb/kod/2026/seriya-1')).toBe(true);
    expect((bot as any).isInScope('/ua/person/actor')).toBe(false);
    expect((bot as any).isInScope('/ua/faq')).toBe(false);
  });

  it('marks pages with weak docs and few controls as low-signal', () => {
    const bot = new DocBot();
    (bot as any).config = { docs: { minCanActions: 1, minInteractiveElements: 3 } };

    expect(
      (bot as any).getLowSignalReason(
        { summary: 'The page currently loads with no visible content.', can: [], might: [] },
        '* Content (0 elements) `main`\n\nChars: 120'
      )
    ).toContain('low-signal page');
  });

  it('keeps pages with proven actions out of low-signal skip', () => {
    const bot = new DocBot();
    (bot as any).config = { docs: { minCanActions: 1, minInteractiveElements: 3 } };

    expect(
      (bot as any).getLowSignalReason(
        { summary: 'Serial details page.', can: [{ action: 'watch episode', scope: 'one item', evidence: 'episode links visible' }], might: [] },
        '* Episodes (10 elements) `.tp-show__list`\n\nChars: 1200'
      )
    ).toBeNull();
  });
});

describe('documentarian fallback', () => {
  it('retries with sanitized research after JSON generation failure', async () => {
    const calls: string[] = [];
    const provider = {
      async generateObject(messages: Array<{ role: string; content: string }>) {
        calls.push(messages[1].content);
        if (calls.length === 1) {
          throw new Error('Failed to generate JSON. Please adjust your prompt. See failed_generation for more details.');
        }
        return {
          object: {
            summary: 'Episode page',
            can: [
              {
                action: 'user can watch the episode',
                scope: 'one item',
                evidence: 'Video player is visible',
              },
            ],
            might: [],
          },
        };
      },
    } as any;

    const documentarian = new Documentarian(provider, {});
    const result = await documentarian.document(
      {
        url: '/ua/serials/stb/kod',
        title: 'K.O.D.',
      },
      `## Content

| Element | Type | ARIA | CSS | Coordinates |
|------|------|------|------|------|
| 'Play button' | link | { role: 'link', text: 'play' } | 'a.about-project__play' | (468, 537) |
| 'Broken row' | link | - | 2026' } | 'a[href="/ua/serials/stb/kod/2026"]' |
`
    );

    expect(result.summary).toBe('Episode page');
    expect(result.can).toHaveLength(1);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain('<fallback_mode>');
  });
});
