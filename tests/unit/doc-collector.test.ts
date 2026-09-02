import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { PNG } from 'pngjs';
import { Documentarian } from '../../boat/doc-collector/src/ai/documentarian.ts';
import { pickDocActionCandidates } from '../../boat/doc-collector/src/ai/tools.ts';
import { DocBot } from '../../boat/doc-collector/src/docbot.ts';
import { normalizeAction, renderPageDocumentation, renderSpecIndex } from '../../boat/doc-collector/src/docs-renderer.ts';
import { getDocPageKey, shouldCrawlDocPath } from '../../boat/doc-collector/src/path-filter.ts';
import { extractResearchNavigationTargets } from '../../boat/doc-collector/src/research-navigation.ts';
import { buildTemplateRecord, findTemplateMatch } from '../../boat/doc-collector/src/template-dedup.ts';
import { captureDocumentationScreenshots, captureEvidenceScreenshots, getScreenshotSections } from '../../boat/doc-collector/src/screenshots.ts';
import { renderMermaidBody } from '../../boat/doc-collector/src/state-diagram.ts';

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

  it('renders user-facing sections first and technical sections last', () => {
    const markdown = renderPageDocumentation(
      {
        url: '/users/sign_in',
        title: 'Testomat.io',
        links: [
          { title: 'Sign up', url: '/users/sign_up' },
          { title: 'Help', url: '/help' },
        ],
      },
      {
        summary: 'Sign in page for existing users',
        can: [{ action: 'user can sign in', scope: 'page-level', evidence: 'Form is visible' }],
        might: [{ action: 'user might reset password', scope: 'one item', evidence: 'Forgot password link' }],
        interactions: [{ action: 'Submit empty form', before: 'Empty form', after: 'Validation errors', newCapabilities: ['Shows field errors'], targetState: { url: '/users/sign_in', kind: 'dialog', label: 'Validation errors' } }],
        qualityNotes: ['Coverage is complete.'],
      },
      [
        {
          title: 'Page screenshot',
          path: 'D:/output/docs/screenshots/p.png',
          relativePath: '../screenshots/p.png',
          kind: 'page',
        },
      ]
    );

    const order = ['## Purpose', '## User Can', '## User Might', '## Screenshots', '## Navigation', '## Coverage Notes', '## State Map', '## State Transitions'].map((heading) => markdown.indexOf(heading));
    for (const index of order) expect(index).toBeGreaterThanOrEqual(0);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('renders navigation links deduped with a title fallback', () => {
    const markdown = renderPageDocumentation(
      {
        url: '/dashboard',
        title: 'Dashboard',
        links: [
          { title: 'Projects', url: '/projects' },
          { title: 'Projects again', url: '/projects' },
          { title: '', url: '/settings' },
          { title: 'Empty', url: '' },
        ],
      },
      { summary: 'Dashboard', can: [], might: [] }
    );

    expect(markdown).toContain('## Navigation');
    expect(markdown).toContain('- Projects: /projects');
    expect(markdown).toContain('- /settings: /settings');
    expect(markdown).not.toContain('Projects again');
    expect(markdown).not.toContain('Empty');
  });

  it('omits the navigation section when the page has no links', () => {
    const markdown = renderPageDocumentation({ url: '/dashboard', title: 'Dashboard' }, { summary: 'Dashboard', can: [], might: [] });

    expect(markdown).not.toContain('## Navigation');
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
    expect(markdown.indexOf('## Pages')).toBeLessThan(markdown.indexOf('## State Transitions'));
    expect(markdown.indexOf('## Skipped')).toBeLessThan(markdown.indexOf('## State Transitions'));
  });

  it('renders a clickable acyclic Mermaid state map with transient states', () => {
    const markdown = renderSpecIndex(
      'D:/project/output/docs',
      '/suites',
      [
        {
          url: '/suites',
          title: 'Suites',
          summary: 'Test suites',
          canCount: 1,
          mightCount: 0,
          interactionCount: 2,
          canActions: [],
          mightActions: [],
          interactionActions: [],
          qualityNotes: [],
          interactions: [
            {
              action: 'Clicked button: Import tests',
              before: 'Suites',
              after: 'Import tests',
              targetState: { kind: 'dialog', label: 'Import tests', url: '/suites' },
              screenshot: { title: 'Import tests', relativePath: '../screenshots/suites_import_tests.png' },
            },
            {
              action: 'Clicked link: Suite',
              before: 'Suites',
              after: 'Suite details',
              targetUrl: '/suites/123',
              targetState: { kind: 'page', label: 'Suite details', url: '/suites/123' },
            },
          ],
          filePath: 'D:/project/output/docs/pages/suites.md',
        },
        {
          url: '/suites/123',
          title: 'Suite details',
          summary: 'Suite details',
          canCount: 1,
          mightCount: 0,
          interactionCount: 1,
          canActions: [],
          mightActions: [],
          interactionActions: [],
          qualityNotes: [],
          interactions: [
            {
              action: 'Clicked link: Back',
              before: 'Suite details',
              after: 'Suites',
              targetUrl: '/suites',
              targetState: { kind: 'page', label: 'Suites', url: '/suites' },
            },
          ],
          filePath: 'D:/project/output/docs/pages/suite-details.md',
        },
      ],
      [],
      20
    );

    expect(markdown).toContain('```mermaid');
    expect(markdown).toContain('flowchart LR');
    expect(markdown).toContain('page0 --> state0');
    expect(markdown).toContain('page0 --> page1');
    expect(markdown).not.toContain('page1 --> page0');
    expect(markdown).toContain('page1 -.-> page0');
    expect(markdown).not.toContain('subgraph ');
    expect(markdown).not.toContain('-->|"');
    expect(markdown).toContain('state0{{"');
    expect(markdown).toContain('classDef dialog');
    expect(markdown).toContain('class state0 dialog');
    expect(markdown).toContain('click page0 "pages/suites.md" "Open Suites"');
    expect(markdown).toContain('click state0 "screenshots/suites_import_tests.png" "Open state screenshot"');
    expect(markdown).toContain('| State | Type | Open |');
    expect(markdown).toContain('[open page](pages/suites.md)');
    expect(markdown).toContain('[view screenshot](screenshots/suites_import_tests.png)');
  });

  it('renders a reverse transition as a dotted back-edge without keyword matching', () => {
    const mermaid = renderMermaidBody('D:/project/output/docs', [
      {
        url: '/x',
        title: 'X',
        summary: 'X',
        canCount: 1,
        mightCount: 0,
        interactionCount: 1,
        canActions: [],
        mightActions: [],
        interactionActions: [],
        qualityNotes: [],
        interactions: [{ action: 'Open Y', before: 'X', after: 'Y', targetState: { kind: 'page', label: 'Y', url: '/y' } }],
        filePath: 'D:/project/output/docs/pages/x.md',
      },
      {
        url: '/y',
        title: 'Y',
        summary: 'Y',
        canCount: 1,
        mightCount: 0,
        interactionCount: 1,
        canActions: [],
        mightActions: [],
        interactionActions: [],
        qualityNotes: [],
        interactions: [{ action: 'Open X', before: 'Y', after: 'X', targetState: { kind: 'page', label: 'X', url: '/x' } }],
        filePath: 'D:/project/output/docs/pages/y.md',
      },
    ]);

    expect(mermaid).toContain('page0 -->|"Open Y"| page1');
    expect(mermaid).toContain('page1 -.->|"Open X"| page0');
  });

  it('renders a back-edge for a transition that closes a cycle longer than two', () => {
    const mermaid = renderMermaidBody('D:/project/output/docs', [
      {
        url: '/a',
        title: 'A',
        summary: 'A',
        canCount: 1,
        mightCount: 0,
        interactionCount: 1,
        canActions: [],
        mightActions: [],
        interactionActions: [],
        qualityNotes: [],
        interactions: [{ action: 'to B', before: 'A', after: 'B', targetState: { kind: 'page', label: 'B', url: '/b' } }],
        filePath: 'D:/project/output/docs/pages/a.md',
      },
      {
        url: '/b',
        title: 'B',
        summary: 'B',
        canCount: 1,
        mightCount: 0,
        interactionCount: 1,
        canActions: [],
        mightActions: [],
        interactionActions: [],
        qualityNotes: [],
        interactions: [{ action: 'to C', before: 'B', after: 'C', targetState: { kind: 'page', label: 'C', url: '/c' } }],
        filePath: 'D:/project/output/docs/pages/b.md',
      },
      {
        url: '/c',
        title: 'C',
        summary: 'C',
        canCount: 1,
        mightCount: 0,
        interactionCount: 1,
        canActions: [],
        mightActions: [],
        interactionActions: [],
        qualityNotes: [],
        interactions: [{ action: 'to A', before: 'C', after: 'A', targetState: { kind: 'page', label: 'A', url: '/a' } }],
        filePath: 'D:/project/output/docs/pages/c.md',
      },
    ]);

    expect(mermaid).toContain('page0 -->|"to B"| page1');
    expect(mermaid).toContain('page1 -->|"to C"| page2');
    expect(mermaid).toContain('page2 -.->|"to A"| page0');
  });

  it('escapes hash, angle brackets, quotes, ampersand, and pipe in mermaid labels', () => {
    const mermaid = renderMermaidBody('D:/project/output/docs', [
      {
        url: '/x',
        title: 'Issue #42: <draft> & "final" | v2',
        summary: 'x',
        canCount: 0,
        mightCount: 0,
        interactionCount: 0,
        canActions: [],
        mightActions: [],
        interactionActions: [],
        qualityNotes: [],
        interactions: [],
        filePath: 'D:/project/output/docs/pages/x.md',
      },
    ]);

    expect(mermaid).toContain('&#35;');
    expect(mermaid).toContain('&#60;');
    expect(mermaid).toContain('&#62;');
    expect(mermaid).toContain('&amp;');
    expect(mermaid).toContain('&quot;');
    expect(mermaid).toContain('&#124;');
    expect(mermaid).not.toContain('#42');
  });

  it('exposes a fence-free Mermaid artifact via renderMermaidBody', () => {
    const mermaid = renderMermaidBody('D:/project/output/docs', [
      {
        url: '/a',
        title: 'Page A',
        summary: 'A',
        canCount: 1,
        mightCount: 0,
        interactionCount: 1,
        canActions: [],
        mightActions: [],
        interactionActions: [],
        qualityNotes: [],
        interactions: [{ action: 'Open B', before: 'A', after: 'B', targetState: { kind: 'page', label: 'B', url: '/b' } }],
        filePath: 'D:/project/output/docs/pages/a.md',
      },
      {
        url: '/b',
        title: 'Page B',
        summary: 'B',
        canCount: 1,
        mightCount: 0,
        interactionCount: 0,
        canActions: [],
        mightActions: [],
        interactionActions: [],
        qualityNotes: [],
        interactions: [],
        filePath: 'D:/project/output/docs/pages/b.md',
      },
    ]);

    expect(mermaid.startsWith('flowchart TD')).toBe(true);
    expect(mermaid).not.toContain('```');
    expect(mermaid).toContain('page0 -->|"Open B"| page1');
  });

  it('renders a compact LR overview that keeps transient edges without action labels', () => {
    const pages = Array.from({ length: 3 }, (_, index) => ({
      url: `/page-${index}`,
      title: `Page ${index}`,
      summary: 'page',
      canCount: 1,
      mightCount: 0,
      interactionCount: 1,
      canActions: [],
      mightActions: [],
      interactionActions: [],
      qualityNotes: [],
      interactions: [
        {
          action: `Open dialog ${index}`,
          before: `Page ${index}`,
          after: `Dialog ${index}`,
          targetState: { kind: 'dialog' as const, label: `Dialog ${index}`, url: `/page-${index}` },
        },
      ],
      filePath: `D:/project/output/docs/pages/page_${index}.md`,
    }));

    const markdown = renderSpecIndex('D:/project/output/docs', '/page-0', pages, [], 20);

    expect(markdown).toContain('```mermaid\nflowchart LR');
    expect(markdown).not.toContain('flowchart TD');
    expect(markdown).not.toContain('-->|"');
    expect(markdown).not.toContain('-.->|"');
    expect(markdown).not.toContain('subgraph ');
    expect(markdown).toContain('page0["Page 0<br/>/page-0"]');
    expect(markdown).toContain('state0{{"Dialog 0<br/>dialog"}}');
    expect(markdown).toContain('page0 --> state0');
    expect(markdown).toContain('classDef dialog');
    expect(markdown).toContain('click page0 "pages/page_0.md" "Open Page 0"');
  });

  it('renders a focused per-page state map when interactions target a transient state', () => {
    const markdown = renderPageDocumentation({ url: '/suites', title: 'Suites' }, {
      summary: 'Suites page',
      can: [],
      might: [],
      interactions: [
        {
          action: 'Clicked button: Import tests',
          before: 'Suites',
          after: 'Import tests',
          targetState: { kind: 'dialog', label: 'Import tests', url: '/suites' },
          screenshot: { title: 'Import tests', relativePath: '../screenshots/suites_import.png' },
        },
      ],
    } as any);

    expect(markdown).toContain('## State Map');
    expect(markdown).toContain('flowchart LR');
    expect(markdown).toContain('self["Suites<br/>/suites"]');
    expect(markdown).toContain('target0{{"Import tests<br/>dialog"}}');
    expect(markdown).toContain('self -->|"Clicked button: Import tests"| target0');
    expect(markdown).toContain('click target0 "../screenshots/suites_import.png" "Import tests"');
  });

  it('omits the per-page state map when no interaction targets a state', () => {
    const markdown = renderPageDocumentation({ url: '/x', title: 'X' }, {
      summary: 'Static',
      can: [],
      might: [],
      interactions: [{ action: 'Clicked button: Save', before: 'x', after: 'y', changes: { urlChanged: false, newElements: 2, removedElements: 0 } }],
    } as any);

    expect(markdown).not.toContain('## State Map');
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
    let annotationsRemoved = false;
    let escapePressed = false;
    const page = {
      keyboard: {
        async press(key: string) {
          escapePressed = key === 'Escape';
        },
      },
      async screenshot(options: { path: string; fullPage?: boolean }) {
        captured.push(options);
      },
      locator(selector: string) {
        if (selector === '[data-explorbot-annotation]') {
          return {
            async evaluateAll() {
              annotationsRemoved = true;
            },
          };
        }
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
      { page } as any,
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
    expect(annotationsRemoved).toBe(true);
    expect(escapePressed).toBe(true);
  });
});

describe('doc-collector scope and signal', () => {
  it('supports all, none, and selected page error ignoring', () => {
    const bot = new DocBot();

    (bot as any).config = { docs: { ignoreErrors: true } };
    expect((bot as any).shouldIgnoreError('Navigation timeout')).toBe(true);

    (bot as any).config = { docs: { ignoreErrors: false } };
    expect((bot as any).shouldIgnoreError('Navigation timeout')).toBe(false);

    (bot as any).config = { docs: { ignoreErrors: ['timeout', 'connection refused'] } };
    expect((bot as any).shouldIgnoreError(new Error('Navigation TIMEOUT after 30s'))).toBe(true);
    expect((bot as any).shouldIgnoreError(Object.assign(new Error('Navigation failed'), { code: 'ERR_CONNECTION_REFUSED' }))).toBe(true);
    expect((bot as any).shouldIgnoreError(new Error('Page crashed'))).toBe(false);

    (bot as any).config = { docs: { ignoreErrors: [''] } };
    expect((bot as any).shouldIgnoreError(new Error('Page crashed'))).toBe(false);
  });

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

describe('doc-collector evidence screenshots', () => {
  const viewport = { width: 1280, height: 720 };
  let screenshotsDir: string;

  const buildPage = (box: { x: number; y: number; width: number; height: number } | null, matches: boolean | number = true, path = '/blog/post') => {
    const png = PNG.sync.write(new PNG({ width: viewport.width, height: viewport.height }));
    const count = typeof matches === 'number' ? matches : matches ? 1 : 0;
    const elementLocator = {
      count: async () => count,
      scrollIntoViewIfNeeded: async () => {},
      boundingBox: async () => box,
    };
    return {
      keyboard: { press: async () => {} },
      url: () => `https://app.test${path}`,
      async screenshot() {
        return png;
      },
      viewportSize() {
        return viewport;
      },
      getByRole() {
        return elementLocator;
      },
      locator(selector: string) {
        if (selector === '[data-explorbot-annotation]') {
          return { async evaluateAll() {} };
        }
        return elementLocator;
      },
    };
  };

  it('crops the proving element with generous context and clamps to the viewport', async () => {
    screenshotsDir = mkdtempSync(join(tmpdir(), 'docbot-evidence-'));
    const shots = await captureEvidenceScreenshots(
      { page: buildPage({ x: 500, y: 300, width: 200, height: 100 }) } as any,
      { url: '/blog/post' },
      { summary: '', might: [], can: [{ action: 'user can share the article', scope: 'page-level', evidence: 'Share button under the article', element: "{ role: 'button', text: 'Share' }" }] },
      { pageFilePath: join(screenshotsDir, 'post.md'), screenshotsDir, config: {} }
    );

    expect(shots).toHaveLength(1);
    expect(shots[0]?.kind).toBe('evidence');
    const cropped = PNG.sync.read(readFileSync(shots[0]!.path));
    expect(cropped.width).toBe(700);
    expect(cropped.height).toBe(600);
    rmSync(screenshotsDir, { recursive: true, force: true });
  });

  it('clamps the crop to the viewport when the element sits at the top-left', async () => {
    screenshotsDir = mkdtempSync(join(tmpdir(), 'docbot-evidence-'));
    const shots = await captureEvidenceScreenshots(
      { page: buildPage({ x: 50, y: 40, width: 100, height: 50 }) } as any,
      { url: '/blog/post' },
      { summary: '', might: [], can: [{ action: 'user can open the menu', scope: 'one item', evidence: 'Menu button in the header', element: "{ role: 'button', text: 'Menu' }" }] },
      { pageFilePath: join(screenshotsDir, 'post.md'), screenshotsDir, config: {} }
    );

    const cropped = PNG.sync.read(readFileSync(shots[0]!.path));
    expect(cropped.width).toBe(400);
    expect(cropped.height).toBe(340);
    rmSync(screenshotsDir, { recursive: true, force: true });
  });

  it('resolves a css selector when the element is not an aria locator', async () => {
    screenshotsDir = mkdtempSync(join(tmpdir(), 'docbot-evidence-'));
    const shots = await captureEvidenceScreenshots(
      { page: buildPage({ x: 500, y: 300, width: 200, height: 100 }) } as any,
      { url: '/blog/post' },
      { summary: '', might: [], can: [{ action: 'user can share the article', scope: 'page-level', evidence: 'Share button under the article', element: '#share-button' }] },
      { pageFilePath: join(screenshotsDir, 'post.md'), screenshotsDir, config: {} }
    );

    expect(shots).toHaveLength(1);
    expect(shots[0]?.kind).toBe('evidence');
    const cropped = PNG.sync.read(readFileSync(shots[0]!.path));
    expect(cropped.width).toBe(700);
    expect(cropped.height).toBe(600);
    rmSync(screenshotsDir, { recursive: true, force: true });
  });

  it('only executes locators present in the research table', async () => {
    screenshotsDir = mkdtempSync(join(tmpdir(), 'docbot-evidence-'));
    const research = ['## Toolbar', '', '| Element | ARIA | CSS |', '|---|---|---|', "| Search | { role: 'button', text: 'Search' } | .search |"].join('\n');
    const shots = await captureEvidenceScreenshots(
      { page: buildPage({ x: 500, y: 300, width: 200, height: 100 }) } as any,
      { url: '/blog/post' },
      {
        summary: '',
        might: [],
        can: [
          { action: 'user can search', scope: 'page-level', evidence: 'Search control', element: "{ role: 'button', text: 'Search' }" },
          { action: 'user can invent a control', scope: 'page-level', evidence: 'Unsupported metadata', element: 'role=button, name=Imaginary' },
        ],
      },
      { pageFilePath: join(screenshotsDir, 'post.md'), screenshotsDir, config: {}, research }
    );

    expect(shots[0]?.kind).toBe('evidence');
    expect(shots[1]).toBeNull();
    rmSync(screenshotsDir, { recursive: true, force: true });
  });

  it('accepts equivalent locator quoting and rejects ambiguous matches', async () => {
    screenshotsDir = mkdtempSync(join(tmpdir(), 'docbot-evidence-'));
    const research = ['## Toolbar', '', '| Element | ARIA | CSS |', '|---|---|---|', "| Search | { role: 'button', text: 'Search' } | .search |"].join('\n');
    const documentation = {
      summary: '',
      might: [],
      can: [{ action: 'user can search', scope: 'page-level' as const, evidence: 'Search control', element: '{ "role": "button", "text": "Search" }' }],
    };

    const unique = await captureEvidenceScreenshots({ page: buildPage({ x: 500, y: 300, width: 200, height: 100 }) } as any, { url: '/blog/post' }, documentation, {
      pageFilePath: join(screenshotsDir, 'post.md'),
      screenshotsDir,
      config: {},
      research,
    });
    const ambiguous = await captureEvidenceScreenshots({ page: buildPage({ x: 500, y: 300, width: 200, height: 100 }, 2) } as any, { url: '/blog/post' }, documentation, {
      pageFilePath: join(screenshotsDir, 'post.md'),
      screenshotsDir,
      config: {},
      research,
    });

    expect(unique[0]?.kind).toBe('evidence');
    expect(ambiguous).toEqual([null]);
    rmSync(screenshotsDir, { recursive: true, force: true });
  });

  it('requires the current query and hash to match the documented page', async () => {
    screenshotsDir = mkdtempSync(join(tmpdir(), 'docbot-evidence-'));
    const documentation = {
      summary: '',
      might: [],
      can: [{ action: 'user can search', scope: 'page-level' as const, evidence: 'Search control', element: '.search' }],
    };

    const matching = await captureEvidenceScreenshots({ page: buildPage({ x: 500, y: 300, width: 200, height: 100 }, true, '/blog/post?tab=search#results') } as any, { url: '/blog/post?tab=search#results' }, documentation, {
      pageFilePath: join(screenshotsDir, 'post.md'),
      screenshotsDir,
      config: {},
    });
    const different = await captureEvidenceScreenshots({ page: buildPage({ x: 500, y: 300, width: 200, height: 100 }, true, '/blog/post?tab=other#results') } as any, { url: '/blog/post?tab=search#results' }, documentation, {
      pageFilePath: join(screenshotsDir, 'post.md'),
      screenshotsDir,
      config: {},
    });

    expect(matching[0]?.kind).toBe('evidence');
    expect(different).toEqual([null]);
    rmSync(screenshotsDir, { recursive: true, force: true });
  });

  it('skips items without a resolvable element', async () => {
    screenshotsDir = mkdtempSync(join(tmpdir(), 'docbot-evidence-'));
    const documentation = {
      summary: '',
      might: [],
      can: [
        { action: 'user can browse the archive', scope: 'page-level', evidence: 'Archive link' },
        { action: 'user can search', scope: 'list of items', evidence: 'Search field', element: 'not-a-locator' },
        { action: 'user can sort results', scope: 'list of items', evidence: 'Sort control', element: "{ role: 'button', text: '' }" },
      ],
    };
    const missingPage = buildPage(null, false, '/x');
    const shotsMissing = await captureEvidenceScreenshots({ page: missingPage } as any, { url: '/x' }, documentation, { pageFilePath: join(screenshotsDir, 'x.md'), screenshotsDir, config: {} });
    const shotsNoBox = await captureEvidenceScreenshots({ page: buildPage(null, true, '/x') } as any, { url: '/x' }, documentation, { pageFilePath: join(screenshotsDir, 'x.md'), screenshotsDir, config: {} });
    const noPage = await captureEvidenceScreenshots({ page: null } as any, { url: '/x' }, documentation, { pageFilePath: join(screenshotsDir, 'x.md'), screenshotsDir, config: {} });

    expect(shotsMissing).toEqual([null, null, null]);
    expect(shotsNoBox).toEqual([null, null, null]);
    expect(noPage).toEqual([null, null, null]);
    rmSync(screenshotsDir, { recursive: true, force: true });
  });

  it('attaches the evidence image under its User Can bullet only', () => {
    const markdown = renderPageDocumentation(
      { url: '/users/sign_in', title: 'Testomat.io' },
      {
        summary: 'Sign in page',
        can: [
          { action: 'user can sign in with email and password', scope: 'page-level', evidence: 'Form is visible', element: "{ role: 'button', text: 'Sign in' }" },
          { action: 'user can request a password reset', scope: 'one item', evidence: 'Reset link' },
        ],
        might: [],
      },
      [],
      [{ title: 'sign in', path: 'a', relativePath: '../screenshots/users_sign_in_can_1.png', kind: 'evidence' }, null]
    );

    expect(markdown).toContain('- user can sign in with email and password -> page-level');
    expect(markdown).toContain('  Proof: Form is visible.\n\n  ![user can sign in with email and password](../screenshots/users_sign_in_can_1.png)\n\n- user can request a password reset');
    expect(markdown).not.toContain('can_2.png');
  });
});

describe('doc-collector template dedup', () => {
  const postSnapshot = [
    '- banner:',
    '  - link "Acme"',
    '- navigation "Main":',
    '  - list:',
    '    - listitem:',
    '      - link "Blog"',
    '- main:',
    '  - article:',
    '    - heading "Shipping velocity" [level=1]',
    '    - paragraph: How we ship weekly.',
    '    - paragraph: More detail here.',
    '    - figure:',
    '      - img "Deploy chart"',
    '    - list:',
    '      - listitem:',
    '        - link "devops"',
    '    - button "Share"',
    '  - section:',
    '    - heading "Comments" [level=2]',
    '    - list:',
    '      - listitem:',
    '        - link "Reply"',
    '- contentinfo:',
    '  - link "Privacy"',
  ].join('\n');

  const siblingPostSnapshot = [
    '- banner:',
    '  - link "Acme"',
    '- navigation "Main":',
    '  - list:',
    '    - listitem:',
    '      - link "Blog"',
    '- main:',
    '  - article:',
    '    - heading "Release notes" [level=1]',
    '    - paragraph: One.',
    '    - paragraph: Two.',
    '    - paragraph: Three.',
    '    - paragraph: Four.',
    '    - paragraph: Five.',
    '    - paragraph: Six.',
    '    - paragraph: Seven.',
    '    - paragraph: Eight.',
    '    - figure:',
    '      - img "Latency graph"',
    '    - list:',
    '      - listitem:',
    '        - link "devops"',
    '      - listitem:',
    '        - link "release"',
    '    - button "Share"',
    '  - section:',
    '    - heading "Comments" [level=2]',
    '    - list:',
    '      - listitem:',
    '        - link "Reply"',
    '- contentinfo:',
    '  - link "Privacy"',
  ].join('\n');

  const variantPostSnapshot = [
    '- main:',
    '  - article:',
    '    - heading "Roadmap" [level=1]',
    '    - paragraph: Where we are going.',
    '    - list:',
    '      - listitem:',
    '        - link "devops"',
    '    - button "Share"',
    '  - section:',
    '    - heading "Comments" [level=2]',
    '    - list:',
    '      - listitem:',
    '        - link "Reply"',
  ].join('\n');

  const swappedPostSnapshot = [
    '- main:',
    '  - article:',
    '    - heading "Roadmap" [level=1]',
    '    - paragraph: Where we are going.',
    '    - blockquote:',
    '      - paragraph: Quoted plan.',
    '      - link "Source"',
    '    - list:',
    '      - listitem:',
    '        - link "devops"',
    '    - button "Share"',
    '  - section:',
    '    - heading "Comments" [level=2]',
    '    - list:',
    '      - listitem:',
    '        - link "Reply"',
  ].join('\n');

  const blogIndexSnapshot = [
    '- main:',
    '  - heading "Blog" [level=1]',
    '  - list:',
    '    - listitem:',
    '      - article:',
    '        - heading "Post one" [level=2]',
    '        - paragraph: Teaser one.',
    '        - link "Read more"',
    '    - listitem:',
    '      - article:',
    '        - heading "Post two" [level=2]',
    '        - paragraph: Teaser two.',
    '        - link "Read more"',
  ].join('\n');

  const aboutSnapshot = ['- main:', '  - heading "About" [level=1]', '  - paragraph: We are Acme.', '  - paragraph: Founded in 2015.', '  - link "Careers"'].join('\n');

  it('matches a sibling post of the same template and names the canonical page', () => {
    const known = [buildTemplateRecord('/blog/shipping-velocity', postSnapshot)!];

    expect(findTemplateMatch(siblingPostSnapshot, known)).toBe('/blog/shipping-velocity');
  });

  it('still matches a post missing one optional block', () => {
    const known = [buildTemplateRecord('/blog/shipping-velocity', postSnapshot)!];

    expect(findTemplateMatch(variantPostSnapshot, known)).toBe('/blog/shipping-velocity');
  });

  it('treats a swapped block as a different page unless the threshold is lowered', () => {
    const known = [buildTemplateRecord('/blog/shipping-velocity', postSnapshot)!];

    expect(findTemplateMatch(swappedPostSnapshot, known)).toBeNull();
    expect(findTemplateMatch(swappedPostSnapshot, known, 80)).toBe('/blog/shipping-velocity');
  });

  it('does not match a blog index against a post', () => {
    const known = [buildTemplateRecord('/blog/shipping-velocity', postSnapshot)!];

    expect(findTemplateMatch(blogIndexSnapshot, known)).toBeNull();
  });

  it('demands near-identity from small generic signatures', () => {
    const firstSettings = ['- main:', '  - heading "Profile" [level=1]', '  - form:', '    - textbox "Name"', '    - checkbox "Visible"', '    - switch "Notifications"', '    - button "Save"', '  - list:', '    - listitem:', '      - link "Back"'].join('\n');
    const secondSettings = ['- main:', '  - heading "Notifications" [level=1]', '  - form:', '    - textbox "Email"', '    - combobox "Frequency"', '    - radio "Weekly"', '    - button "Save"', '  - list:', '    - listitem:', '      - link "Back"'].join('\n');

    expect(buildTemplateRecord('/settings/profile', firstSettings)).not.toBeNull();
    expect(findTemplateMatch(secondSettings, [buildTemplateRecord('/settings/profile', firstSettings)!])).toBeNull();
  });

  it('does not register thin prose pages as templates', () => {
    const thinSnapshot = ['- main:', '  - heading "About" [level=1]', '  - paragraph: We are Acme.', '  - link "Careers"'].join('\n');
    const otherThinSnapshot = ['- main:', '  - heading "Terms" [level=1]', '  - paragraph: Legal text.', '  - link "Privacy"'].join('\n');

    expect(buildTemplateRecord('/about', thinSnapshot)).toBeNull();
    expect(buildTemplateRecord('/about', aboutSnapshot)).toBeNull();
    expect(findTemplateMatch(otherThinSnapshot, [])).toBeNull();
  });

  it('resolves the collapse flag from CLI override and config', () => {
    const bot = new DocBot();
    expect((bot as any).shouldCollapseTemplates()).toBe(true);
    expect((bot as any).shouldCollapseTemplates(false)).toBe(false);
    (bot as any).config = { docs: { collapseTemplatePages: false } };
    expect((bot as any).shouldCollapseTemplates()).toBe(false);
    expect((bot as any).shouldCollapseTemplates(true)).toBe(false);
  });

  it('resolves the similarity threshold with sane bounds', () => {
    const bot = new DocBot();
    expect((bot as any).getTemplateSimilarity()).toBeUndefined();
    expect((bot as any).getTemplateSimilarity(80)).toBe(80);
    expect((bot as any).getTemplateSimilarity(Number.NaN)).toBeUndefined();
    expect((bot as any).getTemplateSimilarity(0)).toBeUndefined();
    expect((bot as any).getTemplateSimilarity(150)).toBeUndefined();
    (bot as any).config = { docs: { templateSimilarity: 85 } };
    expect((bot as any).getTemplateSimilarity()).toBe(85);
    expect((bot as any).getTemplateSimilarity(80)).toBe(80);
  });
});

describe('documentarian fallback', () => {
  it('removes link-backed navigation from generated capabilities', async () => {
    const provider = {
      async generateObject() {
        return {
          object: {
            summary: 'Landing page',
            can: [
              { action: 'user can start onboarding', scope: 'page-level', evidence: 'Get Started link', element: '{ "role": "link", "text": "Get Started" }' },
              { action: 'user can search', scope: 'page-level', evidence: 'Search button', element: '{ "role": "button", "text": "Search" }' },
            ],
            might: [],
          },
        };
      },
    } as any;
    const research = ['## Controls', '', '| Element | ARIA | CSS |', '|---|---|---|', "| Start | { role: 'link', text: 'Get Started' } | a.start |", "| Search | { role: 'button', text: 'Search' } | button.search |"].join('\n');

    const result = await new Documentarian(provider, {}).document({ url: '/', title: 'Home' }, research);

    expect(result.can.map((item) => item.action)).toEqual(['user can search']);
  });

  it('keeps only research-backed non-navigation possible capabilities', async () => {
    const provider = {
      async generateObject() {
        return {
          object: {
            summary: 'Landing page',
            can: [],
            might: [
              { action: 'user might open another page', scope: 'page-level', evidence: 'Card link', element: "{ role: 'link', text: 'Details' }" },
              { action: 'user might search', scope: 'page-level', evidence: 'Search button', element: "{ role: 'button', text: 'Search' }" },
              { action: 'user might export', scope: 'all items', evidence: 'No concrete control', element: null },
              { action: 'user might invent a control', scope: 'page-level', evidence: 'Unsupported locator', element: '.imaginary' },
            ],
          },
        };
      },
    } as any;
    const research = ['## Controls', '', '| Element | ARIA | CSS |', '|---|---|---|', "| Details | { role: 'link', text: 'Details' } | a.details |", "| Search | { role: 'button', text: 'Search' } | button.search |"].join('\n');

    const result = await new Documentarian(provider, {}).document({ url: '/', title: 'Home' }, research);

    expect(result.might.map((item) => item.action)).toEqual(['user might search']);
  });

  it('asks the model only for generated documentation fields', async () => {
    const provider = {
      async generateObject(messages: Array<{ role: string; content: string }>, schema: any) {
        const jsonSchema = z.toJSONSchema(schema) as any;

        expect(jsonSchema.required).toEqual(['summary', 'can', 'might']);
        expect(jsonSchema.properties.interactions).toBeUndefined();
        expect(jsonSchema.properties.can.items.required).toEqual(['action', 'scope', 'evidence', 'element']);
        expect(jsonSchema.properties.can.items.properties.element).toBeDefined();
        expect(messages[1].content).toContain('locator copied verbatim from the page research table');
        expect(messages[1].content).toContain('Return null only when no single element supports the action');
        expect(messages[1].content).not.toContain('interactions:');

        return {
          object: {
            summary: 'Static page',
            can: [],
            might: [],
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

  it('tells the model that navigation is not a capability', async () => {
    let systemPrompt = '';
    const provider = {
      async generateObject(messages: Array<{ role: string; content: string }>) {
        systemPrompt = messages[0].content;
        return {
          object: {
            summary: 'Static page',
            can: [],
            might: [],
          },
        };
      },
    } as any;

    const documentarian = new Documentarian(provider, {});
    await documentarian.document({ url: '/test', title: 'Test' }, '## Content\nStatic research');

    expect(systemPrompt).toContain('Going to another page is navigation, not a capability');
    expect(systemPrompt).toContain('never here');
    expect(systemPrompt).toContain('unrelated embedded support, marketing, consent, or feedback widgets');
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

  it('records a named dialog as a transient target state', async () => {
    const states = [
      { url: '/suites', title: 'Suites', h1: 'Suites', ariaSnapshot: '- heading "Suites"\n- button "Import tests"' },
      { url: '/suites', title: 'Suites', h1: 'Suites', ariaSnapshot: '- heading "Suites"\n- dialog "Import tests":\n  - heading "Import tests"' },
    ];
    let stateIndex = 0;
    const screenshotLifecycle: string[] = [];
    const provider = {
      async generateObject() {
        return {
          object: {
            summary: 'Suites page',
            can: [{ action: 'user can import tests', scope: 'page-level', evidence: 'dialog observed' }],
            might: [],
          },
        };
      },
    } as any;
    const stateManager = { getCurrentState: () => states[stateIndex] } as any;
    const explorer = {
      action() {
        return {
          async attempt(command: string) {
            screenshotLifecycle.push(command.startsWith('I.amOnPage') ? 'restore' : 'click');
            stateIndex = command.startsWith('I.amOnPage') ? 0 : 1;
            return true;
          },
        };
      },
    } as any;
    const documentarian = new Documentarian(provider, { docs: { interactive: true } }, explorer, stateManager);
    const result = await documentarian.document(
      states[0],
      `## Content Controls

| Element | Type | ARIA | CSS |
|------|------|------|------|
| 'Import tests' | button | { role: 'button', text: 'Import tests' } | 'button.import' |`,
      {
        async before() {
          screenshotLifecycle.push('before');
          return Buffer.from('before');
        },
        async after(beforeScreenshot) {
          screenshotLifecycle.push(`after:${beforeScreenshot?.toString()}`);
          return null;
        },
      }
    );

    expect(result.interactions?.[0]?.targetState).toEqual({ kind: 'modal', label: 'Import tests', url: '/suites' });
    expect(screenshotLifecycle).toEqual(['before', 'click', 'after:before', 'restore']);
    expect(stateIndex).toBe(0);
  });

  it('classifies pagination as a section of the same page', async () => {
    const states = [
      { url: '/films', title: 'Films', h1: 'Films', ariaSnapshot: '- heading "Films"\n- link "Page 2"' },
      { url: '/films?page=2', title: 'Films', h1: 'Films', ariaSnapshot: '- heading "Films"\n- link "Item B"' },
    ];
    let stateIndex = 0;
    const provider = {
      async generateObject() {
        return {
          object: {
            summary: 'Films page',
            can: [{ action: 'user can browse films', scope: 'list of items', evidence: 'film tiles visible' }],
            might: [],
          },
        };
      },
    } as any;
    const stateManager = { getCurrentState: () => states[stateIndex] } as any;
    const explorer = {
      action() {
        return {
          async attempt(command: string) {
            stateIndex = command.startsWith('I.amOnPage') ? 0 : 1;
            return true;
          },
        };
      },
    } as any;
    const documentarian = new Documentarian(provider, { docs: { interactive: true } }, explorer, stateManager);
    const result = await documentarian.document(
      states[0],
      `## Content

| Element | Type | ARIA | CSS |
|------|------|------|------|
| 'Page 2' | link | { role: 'link', text: 'Page 2' } | 'a.page-next' |`
    );

    expect(result.interactions?.[0]?.targetState?.kind).toBe('section');
    expect(result.interactions?.[0]?.targetState?.url).toBe('/films?page=2');
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
      { action: 'Clicked button: No change', before: '1', after: '1', discoveredUrls: [], changes: { urlChanged: false, newElements: 0, removedElements: 0 } },
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

    const mockStateManager = {
      getCurrentState() {
        return {
          url: '/test',
          title: 'Test',
          ariaSnapshot: '[role: button]',
        };
      },
    } as any;
    const mockExplorer = {
      action() {
        return {
          async execute(command: string) {
            return true;
          },
        };
      },
    } as any;

    const documentarian = new Documentarian(provider, { docs: { interactive: true } }, mockExplorer, mockStateManager);

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

    const mockStateManager = {
      getCurrentState() {
        return {
          url: '/test',
          title: 'Test',
          ariaSnapshot: '[role: button]',
        };
      },
    } as any;
    const mockExplorer = {
      action() {
        return {
          async execute(command: string) {
            return true;
          },
        };
      },
    } as any;

    const documentarian = new Documentarian(provider, { docs: { interactive: true } }, mockExplorer, mockStateManager);

    const result = await documentarian.document(
      {
        url: '/test',
        title: 'Test',
      },
      '## Content\nResearch'
    );

    expect(result.summary).toBe('Static fallback');
  });

  it('combines static documentation with observed interactions when interactive documentation fails JSON validation', async () => {
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
    const mockStateManager = {
      getCurrentState() {
        return states[stateIndex];
      },
    } as any;
    const mockExplorer = {
      action() {
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

    const documentarian = new Documentarian(provider, { docs: { interactive: true } }, mockExplorer, mockStateManager);
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
    expect(result.can).toEqual([
      {
        action: 'user can view content',
        scope: 'page-level',
        evidence: 'fallback after invalid interactive JSON',
      },
    ]);
    expect(result.interactions).toHaveLength(1);
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

    const mockStateManager = {
      getCurrentState() {
        return {
          url: '/test',
          title: 'Test',
          ariaSnapshot: '[role: tab]',
        };
      },
    } as any;
    const mockExplorer = {
      action() {
        return {
          async execute(command: string) {
            return true;
          },
        };
      },
    } as any;

    const documentarian = new Documentarian(provider, { docs: { interactive: true } }, mockExplorer, mockStateManager);

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

    const mockStateManager = {
      getCurrentState() {
        return {
          url: '/test',
          title: 'Test',
          ariaSnapshot: '[role: button]',
        };
      },
    } as any;
    const mockExplorer = {
      action() {
        return {
          async execute() {
            return true;
          },
        };
      },
    } as any;

    const documentarian = new Documentarian(provider, {}, mockExplorer, mockStateManager);
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
