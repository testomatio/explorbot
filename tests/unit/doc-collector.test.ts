import { describe, expect, it } from 'bun:test';
import { DocBot } from '../../boat/doc-collector/src/docbot.ts';
import { Documentarian } from '../../boat/doc-collector/src/ai/documentarian.ts';
import { pickDocActionCandidates } from '../../boat/doc-collector/src/ai/tools.ts';
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
    ).toEqual(['/docs/openapi#tag/project-analytics-tags', '/docs/openapi#tag/project-analytics-labels', '/docs/openapi#tag/project-analytics-jira']);
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
          interactionCount: 1,
          canActions: ['user can sign in with email and password'],
          mightActions: ['user might use social login'],
          interactionActions: ['Opened detail page: Login help'],
          qualityNotes: ['Coverage is complete for the visible sign-in form.'],
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
    expect(markdown).toContain('Interactive transitions: 1');
    expect(markdown).toContain('User Can:');
    expect(markdown).toContain('- user can sign in with email and password');
    expect(markdown).toContain('User Might:');
    expect(markdown).toContain('- user might use social login');
    expect(markdown).toContain('Interactive Findings:');
    expect(markdown).toContain('- Opened detail page: Login help');
    expect(markdown).toContain('Coverage Notes:');
    expect(markdown).toContain('- Coverage is complete for the visible sign-in form.');
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

    expect((bot as any).getLowSignalReason({ summary: 'The page currently loads with no visible content.', can: [], might: [] }, '* Content (0 elements) `main`\n\nChars: 120')).toContain('low-signal page');
  });

  it('keeps pages with proven actions out of low-signal skip', () => {
    const bot = new DocBot();
    (bot as any).config = { docs: { minCanActions: 1, minInteractiveElements: 3 } };

    expect((bot as any).getLowSignalReason({ summary: 'Serial details page.', can: [{ action: 'watch episode', scope: 'one item', evidence: 'episode links visible' }], might: [] }, '* Episodes (10 elements) `.tp-show__list`\n\nChars: 1200')).toBeNull();
  });
});

describe('doc-collector interactive candidate selection', () => {
  it('prioritizes content detail links over global navigation categories', () => {
    const research = `
## Content

| Element | Type | ARIA | CSS |
|------|------|------|------|
| 'Серіали' | link | { role: 'link', text: 'Серіали' } | 'a.menu-link' |
| 'Граф Дракула: Історія кохання' | link | { role: 'link', text: 'Граф Дракула: Історія кохання' } | 'a.movie-card__title' |
| 'Материнська любов' | link | { role: 'link', text: 'Материнська любов' } | 'a.movie-card__title' |
| 'Моя провина: Лондон' | link | { role: 'link', text: 'Моя провина: Лондон' } | 'a.movie-card__title' |

## Navigation

| Element | Type | ARIA | CSS |
|------|------|------|------|
| 'Фільми' | link | { role: 'link', text: 'Фільми' } | 'header a[href="/films/"]' |
| '7' | link | { role: 'link', text: '7' } | '.pagination a.current' |
| '8' | link | { role: 'link', text: '8' } | '.pagination a' |
`;

    expect(pickDocActionCandidates(research)).toEqual([
      { label: 'Граф Дракула: Історія кохання', kind: 'detail', section: 'content' },
      { label: 'Материнська любов', kind: 'detail', section: 'content' },
      { label: 'Моя провина: Лондон', kind: 'detail', section: 'content' },
    ]);
  });
  it('ignores modal overlay buttons when selecting action candidates', () => {
    const research = `
## overlay: AskTelegram Modal

> Container: 'ask_modal_overlay'

| Element | Type | ARIA | CSS |
|------|------|------|------|
| 'Підписатися' | button | { role: 'button', text: 'Підписатися' } | 'ask_modal_yes' |
| 'Ні, дякую' | button | { role: 'button', text: 'Ні, дякую' } | 'ask_modal_no' |
`;

    expect(pickDocActionCandidates(research)).toEqual([]);
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

  it('retries with sanitized research after schema mismatch response', async () => {
    const calls: string[] = [];
    const provider = {
      async generateObject(messages: Array<{ role: string; content: string }>) {
        calls.push(messages[1].content);
        if (calls.length === 1) {
          throw new Error('No object generated: response did not match schema.');
        }
        return {
          object: {
            summary: 'Catalog page',
            can: [
              {
                action: 'user can browse items',
                scope: 'list of items',
                evidence: 'Item links are visible',
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
        url: '/catalog',
        title: 'Catalog',
      },
      `## Content

| Element | Type | ARIA | CSS |
|------|------|------|------|
| 'Broken row' | link | - | broken
| 'Item A' | link | { role: 'link', text: 'Item A' } | 'a.item' |
`
    );

    expect(result.summary).toBe('Catalog page');
    expect(result.can).toHaveLength(1);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain('<fallback_mode>');
  });
});

describe('documentarian output normalization', () => {
  it('compacts shell navigation actions and drops weak add-to-list assumptions', async () => {
    const provider = {
      async generateObject() {
        return {
          object: {
            summary: 'Catalog page',
            can: [
              { action: "user can navigate to the 'Serials' section", scope: 'page-level', evidence: 'visible in navigation' },
              { action: "user can navigate to the 'Cartoons' section", scope: 'page-level', evidence: 'visible in navigation' },
              { action: "user can navigate to the 'Films' section", scope: 'page-level', evidence: 'visible in navigation' },
              { action: "user can click the 'My Lists' link to navigate to their personal lists page", scope: 'page-level', evidence: 'visible in navigation' },
              { action: "user can click the 'Login' link to access the login page", scope: 'page-level', evidence: 'visible in navigation' },
              { action: 'user can type a search query in the search textbox and press the search button to perform a search', scope: 'page-level', evidence: 'textbox and button visible' },
              { action: 'user can navigate between pages using the pagination links', scope: 'page-level', evidence: 'pagination visible' },
              { action: 'user can navigate to the external streaming site "Watch online"', scope: 'page-level', evidence: 'external link visible' },
            ],
            might: [
              { action: 'user might be able to click on an individual film item to view its detail page', scope: 'one item', evidence: 'Typical catalog pages display film thumbnails that are clickable.' },
              { action: 'user might be able to add a film to a personal list from the list view', scope: 'one item', evidence: "The presence of a 'My Lists' menu suggests functionality to manage lists, though no add-to-list UI is shown." },
            ],
          },
        };
      },
    } as any;

    const documentarian = new Documentarian(provider, {});
    const result = await documentarian.document(
      {
        url: '/films/best/2025/page/7/',
        title: 'Films',
      },
      `## Menu

| Element | Type | ARIA | CSS |
|------|------|------|------|
| 'Serials' | link | { role: 'link', text: 'Serials' } | 'a[href="/series/"]' |
| 'Cartoons' | link | { role: 'link', text: 'Cartoons' } | 'a[href="/cartoons/"]' |
| 'Films' | link | { role: 'link', text: 'Films' } | 'a[href="/films/"]' |
| 'My Lists' | link | { role: 'link', text: 'My Lists' } | 'a[href="/mylists/"]' |
| 'Login' | link | { role: 'link', text: 'Login' } | 'a[href="/login/"]' |
`
    );

    expect(result.can.map((item) => item.action)).toEqual([
      'user can navigate to major site sections using the visible navigation links',
      'user can access account-related pages from the visible header links',
      'user can type a search query in the search textbox and press the search button to perform a search',
      'user can navigate between pages using the pagination links',
      'user can open external links shown on the page',
    ]);
    expect(result.might.map((item) => item.action)).toEqual(['user might be able to click on an individual film item to view its detail page']);
    expect((result as any).qualityNotes).toEqual(['Research did not provide a dedicated content section, so content-specific behavior may be under-documented.']);
  });
});

describe('documentarian interactive mode', () => {
  it('uses static mode when interactive is disabled', async () => {
    const provider = {
      async generateObject() {
        return {
          object: {
            summary: 'Static page',
            can: [{ action: 'user can view', scope: 'page-level', evidence: 'visible' }],
            might: [],
          },
        };
      },
      getModelForAgent() {
        return 'mock-model';
      },
    } as any;

    const documentarian = new Documentarian(provider, { docs: { interactive: false } });
    const result = await documentarian.document(
      {
        url: '/test',
        title: 'Test',
      },
      '## Content\nStatic research'
    );

    expect(result.summary).toBe('Static page');
    expect(result.can).toHaveLength(1);
  });

  it('uses static mode when explorer is not provided', async () => {
    const provider = {
      async generateObject() {
        return {
          object: {
            summary: 'Static page',
            can: [{ action: 'user can view', scope: 'page-level', evidence: 'visible' }],
            might: [],
          },
        };
      },
    } as any;

    const documentarian = new Documentarian(provider, { docs: { interactive: true } });
    const result = await documentarian.document(
      {
        url: '/test',
        title: 'Test',
      },
      '## Content\nStatic research'
    );

    expect(result.summary).toBe('Static page');
  });

  it('keeps only meaningful interactive transitions', () => {
    const documentarian = new Documentarian({} as any, { docs: { interactive: true } });
    const interactions = (documentarian as any).getMeaningfulInteractions([
      { action: 'Opened detail page: Movie A', before: '1', after: '2', targetUrl: '/movies/a' },
      { action: 'Opened pagination page: 8', before: '1', after: '2', targetUrl: '/films/page/8' },
      { action: 'Switched to tab: Merged', before: '1', after: '2' },
      { action: 'Activated button: Save', before: '1', after: '2' },
      { action: 'Opened category page: Cartoons', before: '1', after: '2', targetUrl: '/cartoons/' },
      { action: 'I.click("Cartoons")', before: '1', after: '2', targetUrl: '/cartoons/' },
    ]);

    expect(interactions).toHaveLength(4);
    expect(interactions.map((item: any) => item.action)).toEqual(['Opened detail page: Movie A', 'Opened pagination page: 8', 'Switched to tab: Merged', 'Activated button: Save']);
  });

  it('does not render empty new-capabilities block for transitions without discoveries', () => {
    const markdown = renderPageDocumentation(
      {
        url: '/branches',
        title: 'Branches',
      },
      {
        summary: 'Branches page',
        can: [],
        might: [],
        interactions: [
          {
            action: 'Switched to tab: Merged',
            before: '12 elements (tab:2, link:4, button:2)',
            after: 'Tab content: 21 elements (link:8, button:3)',
            newCapabilities: [],
          },
        ],
      } as any
    );

    expect(markdown).toContain('## State Transitions');
    expect(markdown).not.toContain('**New capabilities discovered:**');
  });

  it('falls back to static mode when interactive mode fails', async () => {
    const provider = {
      async generateWithTools() {
        throw new Error('Tool execution failed: interaction error');
      },
      async generateObject() {
        return {
          object: {
            summary: 'Static fallback',
            can: [{ action: 'user can view', scope: 'page-level', evidence: 'fallback' }],
            might: [],
          },
        };
      },
      getModelForAgent() {
        return 'mock-model';
      },
    } as any;

    const mockExplorer = {
      getStateManager() {
        return {
          getCurrentState() {
            return {
              url: '/test',
              title: 'Test',
              ariaSnapshot: '[role: button]',
            };
          },
        };
      },
      createAction() {
        return {
          async execute(command: string) {
            return true;
          },
        };
      },
    } as any;

    const documentarian = new Documentarian(provider, { docs: { interactive: true } }, mockExplorer);

    const result = await documentarian.document(
      {
        url: '/test',
        title: 'Test',
      },
      '## Content\nResearch'
    );

    expect(result.summary).toBe('Static fallback');
    expect(result.can).toHaveLength(1);
  });

  it('falls back to static mode when tool failure is capitalized in error text', async () => {
    const provider = {
      async generateWithTools() {
        throw new Error('Tool execution failed');
      },
      async generateObject() {
        return {
          object: {
            summary: 'Static fallback',
            can: [{ action: 'user can view', scope: 'page-level', evidence: 'fallback' }],
            might: [],
          },
        };
      },
      getModelForAgent() {
        return 'mock-model';
      },
    } as any;

    const mockExplorer = {
      getStateManager() {
        return {
          getCurrentState() {
            return {
              url: '/test',
              title: 'Test',
              ariaSnapshot: '[role: button]',
            };
          },
        };
      },
      createAction() {
        return {
          async execute(command: string) {
            return true;
          },
        };
      },
    } as any;

    const documentarian = new Documentarian(provider, { docs: { interactive: true } }, mockExplorer);

    const result = await documentarian.document(
      {
        url: '/test',
        title: 'Test',
      },
      '## Content\nResearch'
    );

    expect(result.summary).toBe('Static fallback');
  });

  it('falls back to static mode when interactive documentation fails JSON validation', async () => {
    const provider = {
      async generateObject(messages: Array<{ role: string; content: string }>) {
        const prompt = messages[1].content;
        if (prompt.includes('<interactions_found>')) {
          throw new Error('Failed to validate JSON. Please adjust your prompt. See failed_generation for more details.');
        }

        return {
          object: {
            summary: 'Static fallback',
            can: [{ action: 'user can view content', scope: 'page-level', evidence: 'fallback after invalid interactive JSON' }],
            might: [],
          },
        };
      },
      getModelForAgent() {
        return 'mock-model';
      },
    } as any;

    const states = [
      {
        url: '/films',
        title: 'Films',
        ariaSnapshot: '[role: link]\n[role: heading]',
      },
      {
        url: '/films/dracula',
        title: 'Dracula',
        ariaSnapshot: '[role: heading]\n[role: link]\n[role: img]',
      },
    ];

    let stateIndex = 0;
    const mockExplorer = {
      getStateManager() {
        return {
          getCurrentState() {
            return states[stateIndex];
          },
        };
      },
      createAction() {
        return {
          async attempt(command: string) {
            if (command.startsWith('I.click')) {
              stateIndex = 1;
              return true;
            }
            if (command.startsWith('I.amOnPage')) {
              stateIndex = 0;
              return true;
            }
            return false;
          },
        };
      },
    } as any;

    const documentarian = new Documentarian(provider, { docs: { interactive: true } }, mockExplorer);
    const result = await documentarian.document(
      {
        url: '/films',
        title: 'Films',
      },
      `## content

> Container: 'main'

| Element | Type | ARIA | CSS |
|------|------|------|------|
| 'Граф Дракула: Історія кохання' | link | { role: 'link', text: 'Граф Дракула: Історія кохання' } | 'a.movie-card__title' |
`
    );

    expect(result.summary).toBe('Static fallback');
    expect((result as any).interactions).toBeUndefined();
  });

  it('does not call tool fallback when deterministic interactions are unavailable', async () => {
    const provider = {
      async generateWithTools() {
        throw new Error('tool fallback should not be used');
      },
      async generateObject(messages: Array<{ role: string; content: string }>) {
        const prompt = messages[1].content;
        expect(prompt).not.toContain('<interactions_found>');

        return {
          object: {
            summary: 'Static page',
            can: [{ action: 'user can view content', scope: 'page-level', evidence: 'static research only' }],
            might: [],
          },
        };
      },
      getModelForAgent() {
        return 'mock-model';
      },
    } as any;

    const mockExplorer = {
      getStateManager() {
        return {
          getCurrentState() {
            return {
              url: '/test',
              title: 'Test',
              ariaSnapshot: '[role: tab]',
            };
          },
        };
      },
      createAction() {
        return {
          async execute(command: string) {
            return true;
          },
        };
      },
    } as any;

    const documentarian = new Documentarian(provider, { docs: { interactive: true } }, mockExplorer);

    const result = await documentarian.document(
      {
        url: '/test',
        title: 'Test',
      },
      '## Content\nLinks only'
    );

    expect(result.summary).toBe('Static page');
  });
});

describe('documentarian interactive defaults', () => {
  it('uses static mode by default when interactive is not configured', async () => {
    const provider = {
      async generateObject() {
        return {
          object: {
            summary: 'Static by default',
            can: [{ action: 'user can view', scope: 'page-level', evidence: 'visible' }],
            might: [],
          },
        };
      },
      async generateWithTools() {
        throw new Error('interactive tools should not be called by default');
      },
    } as any;

    const mockExplorer = {
      getStateManager() {
        return {
          getCurrentState() {
            return {
              url: '/test',
              title: 'Test',
              ariaSnapshot: '[role: button]',
            };
          },
        };
      },
      createAction() {
        return {
          async execute() {
            return true;
          },
        };
      },
    } as any;

    const documentarian = new Documentarian(provider, {}, mockExplorer);
    const result = await documentarian.document(
      {
        url: '/test',
        title: 'Test',
      },
      '## Content\nButtons'
    );

    expect(result.summary).toBe('Static by default');
  });
});

describe('docbot interactive path extraction', () => {
  it('adds discovered urls from interactions into next crawl targets', () => {
    const bot = new DocBot();
    (bot as any).config = { docs: { scope: 'site' } };

    const nextPaths = (bot as any).extractNextPaths(
      {
        url: '/branches',
        title: 'Branches',
        links: [],
      },
      'https://example.com',
      '## Content\nBranches',
      {
        interactions: [
          {
            action: 'Switched to tab: Merged',
            before: '12 elements',
            after: '21 elements',
            discoveredUrls: ['/branches/merged/1', '/branches/merged/2'],
          },
          {
            action: 'I.click("Save")',
            before: '8 elements',
            after: '12 elements',
            targetUrl: '/runs/123',
            discoveredUrls: ['/runs/123/details'],
          },
        ],
      }
    );

    expect(nextPaths).toEqual(['/branches/merged/1', '/branches/merged/2', '/runs/123', '/runs/123/details']);
  });

  it('prioritizes interaction-discovered paths ahead of generic page links', () => {
    const bot = new DocBot();
    (bot as any).config = { docs: { scope: 'site' } };

    const nextPaths = (bot as any).extractNextPaths(
      {
        url: '/films/best',
        title: 'Films',
        links: [
          { title: 'Home', url: '/' },
          { title: 'Series', url: '/series/' },
        ],
      },
      'https://example.com',
      '',
      {
        interactions: [
          {
            action: 'Opened detail page: Movie A',
            before: '1',
            after: '2',
            targetUrl: '/movies/a',
            discoveredUrls: ['/movies/a/trailer'],
          },
        ],
      }
    );

    expect(nextPaths).toEqual(['/movies/a', '/movies/a/trailer', '/', '/series/']);
  });
});
