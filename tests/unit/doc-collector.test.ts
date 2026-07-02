import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { Documentarian } from '../../boat/doc-collector/src/ai/documentarian.ts';
import { pickDocActionCandidates } from '../../boat/doc-collector/src/ai/tools.ts';
import { DocBot } from '../../boat/doc-collector/src/docbot.ts';
import { normalizeAction, renderPageDocumentation, renderSpecIndex } from '../../boat/doc-collector/src/docs-renderer.ts';
import { getDocPageKey, shouldCrawlDocPath } from '../../boat/doc-collector/src/path-filter.ts';
import { extractResearchNavigationTargets } from '../../boat/doc-collector/src/research-navigation.ts';
import { captureDocumentationScreenshots, getScreenshotSections } from '../../boat/doc-collector/src/screenshots.ts';

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

  it('renders page and section screenshots as markdown images', () => {
    const markdown = renderPageDocumentation(
      {
        url: '/users/sign_in',
        title: 'Testomat.io',
      },
      {
        summary: 'Sign in page for existing users',
        can: [],
        might: [],
      },
      [
        {
          title: 'Page screenshot',
          path: 'D:/project/output/docs/screenshots/users_sign_in_page.png',
          relativePath: '../screenshots/users_sign_in_page.png',
          kind: 'page',
        },
        {
          title: 'Login form',
          path: 'D:/project/output/docs/screenshots/users_sign_in_login_form.png',
          relativePath: '../screenshots/users_sign_in_login_form.png',
          kind: 'section',
          selector: '.login-form',
        },
      ]
    );

    expect(markdown).toContain('## Screenshots');
    expect(markdown).toContain('![Page screenshot](../screenshots/users_sign_in_page.png)');
    expect(markdown).toContain('![Login form](../screenshots/users_sign_in_login_form.png)');
    expect(markdown).toContain('Section: `.login-form`');
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
          interactionActions: ['Clicked link: Login help'],
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
    expect(markdown).toContain('- Clicked link: Login help');
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

describe('doc-collector screenshots', () => {
  it('selects section containers from research for cropped screenshots', () => {
    const research = `
## Navigation

> Container: '.mainnav-menu'

| Element | Type | ARIA | CSS |
|------|------|------|------|
| 'Projects' | link | { role: 'link', text: 'Projects' } | 'a[href="/"]' |

## Empty Section

> Container: '.empty'

## Content

> Container: '.main-content'

| Element | Type | ARIA | CSS |
|------|------|------|------|
| 'Create' | button | { role: 'button', text: 'Create' } | 'button.primary' |
`;

    expect(getScreenshotSections(research)).toEqual([
      { title: 'Navigation', selector: '.mainnav-menu' },
      { title: 'Content', selector: '.main-content' },
    ]);
  });

  it('captures full page and section screenshots from research containers', async () => {
    const captured: Array<{ selector?: string; path: string; fullPage?: boolean }> = [];
    const page = {
      async screenshot(options: { path: string; fullPage?: boolean }) {
        captured.push(options);
      },
      locator(selector: string) {
        return {
          first() {
            return {
              async screenshot(options: { path: string }) {
                captured.push({ selector, path: options.path });
              },
            };
          },
        };
      },
    };

    const screenshots = await captureDocumentationScreenshots(
      { playwrightHelper: { page } } as any,
      { url: '/users/sign_in' },
      `
## Navigation

> Container: '.mainnav-menu'

| Element | Type | ARIA | CSS |
|------|------|------|------|
| 'Projects' | link | { role: 'link', text: 'Projects' } | 'a[href="/"]' |

## Content

> Container: '.main-content'

| Element | Type | ARIA | CSS |
|------|------|------|------|
| 'Create' | button | { role: 'button', text: 'Create' } | 'button.primary' |
`,
      {
        pageFilePath: 'output/docs/pages/users_sign_in.md',
        screenshotsDir: 'output/docs/screenshots',
        config: { docs: { maxSectionScreenshots: 1 } },
      }
    );

    expect(screenshots.map((screenshot) => screenshot.kind)).toEqual(['page', 'section']);
    expect(screenshots[0].relativePath).toBe('../screenshots/users_sign_in_page.png');
    expect(screenshots[1].relativePath).toBe('../screenshots/users_sign_in_navigation.png');
    expect(captured.map((item) => item.selector)).toEqual([undefined, '.mainnav-menu']);
  });
});

describe('doc-collector scope and signal', () => {
  it('keeps subtree scope around the start page', () => {
    const bot = new DocBot();
    (bot as any).config = { docs: { scope: 'subtree' } };
    (bot as any).scopeRoot = '/workspace/projects/main';

    expect((bot as any).isInScope('/workspace/projects/main/reports')).toBe(true);
    expect((bot as any).isInScope('/workspace/projects/main/reports/weekly')).toBe(true);
    expect((bot as any).isInScope('/workspace/settings')).toBe(false);
    expect((bot as any).isInScope('/help')).toBe(false);
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
  it('prioritizes non-navigation controls without assigning semantic categories', () => {
    const research = `
## Content

| Element | Type | ARIA | CSS |
|------|------|------|------|
| 'Products' | link | { role: 'link', text: 'Products' } | 'a.menu-link' |
| 'Quarterly report' | link | { role: 'link', text: 'Quarterly report' } | 'a.result-title' |
| 'Account overview' | link | { role: 'link', text: 'Account overview' } | 'a.result-title' |
| 'Billing settings' | link | { role: 'link', text: 'Billing settings' } | 'a.result-title' |

## Navigation

| Element | Type | ARIA | CSS |
|------|------|------|------|
| 'Products' | link | { role: 'link', text: 'Products' } | 'header a[href="/products/"]' |
| '7' | link | { role: 'link', text: '7' } | '.pagination a.current' |
| '8' | link | { role: 'link', text: '8' } | '.pagination a' |
`;

    const candidates = pickDocActionCandidates(research);
    expect(candidates).toHaveLength(3);
    expect(candidates.map((candidate) => candidate.role)).toEqual(['link', 'link', 'link']);
    expect(candidates.map((candidate) => candidate.section)).toEqual(['Content', 'Content', 'Content']);
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

  it('keeps content control candidates inside sticky header containers', () => {
    const research = `
## Content Filters Controls

> Container: '.sticky-header .first'

| Element | Type | ARIA | CSS |
|------|------|------|------|
| 'Automated' | link | { role: 'link', text: 'Automated' } | 'a.filter-tab' |
| 'Unfinished' | link | { role: 'link', text: 'Unfinished' } | 'a.filter-tab' |

## Control Create New Branch

> Container: '.flex-none.black'

| Element | Type | ARIA | CSS |
|------|------|------|------|
| 'Create New Branch' | button | { role: 'button', text: 'Create New Branch' } | 'button.primary-btn' |
`;

    expect(pickDocActionCandidates(research).map((candidate) => candidate.label)).toEqual(['Automated', 'Unfinished', 'Create New Branch']);
  });

  it('keeps navigation and destructive actions out of interactive candidates', () => {
    const research = `
## Navigation

> Container: '.mainnav-menu'

| Element | Type | ARIA | CSS |
|------|------|------|------|
| 'Branches' | link | { role: 'link', text: 'Branches' } | 'a[href="/branches"]' |

## Content

| Element | Type | ARIA | CSS |
|------|------|------|------|
| 'View Branch' | link | { role: 'link', text: 'View Branch' } | 'a.branch' |
| 'Delete Branch' | button | { role: 'button', text: 'Delete Branch' } | 'button.delete' |
| 'Archive Branch' | button | { role: 'button', text: 'Archive Branch' } | 'button.archive' |
`;

    expect(pickDocActionCandidates(research)).toEqual([{ label: 'View Branch', role: 'link', section: 'Content' }]);
  });

  it('allows candidate limits to be configured', () => {
    const research = `
## Content

| Element | Type | ARIA | CSS |
|------|------|------|------|
| 'Item A' | link | { role: 'link', text: 'Item A' } | 'a.item-a' |
| 'Item B' | link | { role: 'link', text: 'Item B' } | 'a.item-b' |
| 'Item C' | link | { role: 'link', text: 'Item C' } | 'a.item-c' |
| 'Item D' | link | { role: 'link', text: 'Item D' } | 'a.item-d' |
`;

    expect(pickDocActionCandidates(research, { docs: { maxPrimaryCandidates: 4 } })).toHaveLength(4);
  });
});

describe('documentarian fallback', () => {
  it('uses strict-compatible schema for interaction element metadata', async () => {
    const provider = {
      async generateObject(_messages: Array<{ role: string; content: string }>, schema: any) {
        const jsonSchema = z.toJSONSchema(schema) as any;
        const interaction = jsonSchema.properties.interactions.anyOf[0].items;
        const element = interaction.properties.element.anyOf[0];

        expect(interaction.required).toContain('element');
        expect(element.required).toEqual(['role', 'name', 'section', 'container', 'locator']);

        return {
          object: {
            summary: 'Static page',
            can: [],
            might: [],
            interactions: null,
          },
        };
      },
    } as any;

    const documentarian = new Documentarian(provider, {});
    const result = await documentarian.document(
      {
        url: '/test',
        title: 'Test',
      },
      '## Content\nStatic research'
    );

    expect(result.interactions).toBeUndefined();
  });

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
        url: '/workspace/projects/main',
        title: 'K.O.D.',
      },
      `## Content

| Element | Type | ARIA | CSS | Coordinates |
|------|------|------|------|------|
| 'Play button' | link | { role: 'link', text: 'play' } | 'a.about-project__play' | (468, 537) |
| 'Broken row' | link | - | 2026' } | 'a[href="/workspace/projects/main/reports"]' |
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
      { action: 'Clicked link: Item A', before: '1', after: '2', targetUrl: '/items/a' },
      { action: 'Clicked button: Save', before: '1', after: '2', changes: { urlChanged: false, newElements: 2, removedElements: 0 } },
      { action: 'Clicked tab: Merged', before: '1', after: '2', discoveredUrls: ['/branches/merged'] },
      { action: 'Clicked button: No change', before: '1', after: '1', changes: { urlChanged: false, newElements: 0, removedElements: 0 } },
    ]);

    expect(interactions).toHaveLength(3);
    expect(interactions.map((item: any) => item.action)).toEqual(['Clicked link: Item A', 'Clicked button: Save', 'Clicked tab: Merged']);
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
            action: 'Clicked tab: Merged',
            before: '12 elements (tab:2, link:4, button:2)',
            after: 'Tab content: 21 elements (link:8, button:3)',
            newCapabilities: [],
          },
        ],
      } as any
    );

    expect(markdown).toContain('## State Transitions');
    expect(markdown).not.toContain('**Observed changes:**');
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
        if (prompt.includes('<interaction_observations>')) {
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
        url: '/items',
        title: 'Items',
        ariaSnapshot: '[role: link]\n[role: heading]',
      },
      {
        url: '/items/example',
        title: 'Example Item',
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
        url: '/items',
        title: 'Items',
      },
      `## content

> Container: 'main'

| Element | Type | ARIA | CSS |
|------|------|------|------|
| 'Quarterly report' | link | { role: 'link', text: 'Quarterly report' } | 'a.result-title' |
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
        expect(prompt).not.toContain('<interaction_observations>');

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
            action: 'Clicked tab: Merged',
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
        url: '/items',
        title: 'Items',
        links: [
          { title: 'Home', url: '/' },
          { title: 'Collection', url: '/collections/' },
        ],
      },
      'https://example.com',
      '',
      {
        interactions: [
          {
            action: 'Clicked link: Item A',
            before: '1',
            after: '2',
            targetUrl: '/items/a',
            discoveredUrls: ['/items/a/details'],
          },
        ],
      }
    );

    expect(nextPaths).toEqual(['/items/a', '/items/a/details', '/', '/collections/']);
  });
});
