import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { htmlCombinedSnapshot, htmlMinimalUISnapshot, htmlTextSnapshot } from '../../src/utils/html.ts';

// Load test HTML files
const githubHtml = readFileSync(join(process.cwd(), 'test-data/github.html'), 'utf8');

const gitlabHtml = readFileSync(join(process.cwd(), 'test-data/gitlab.html'), 'utf8');

const testomatHtml = readFileSync(join(process.cwd(), 'test-data/testomat.html'), 'utf8');

const checkoutHtml = readFileSync(join(process.cwd(), 'test-data/checkout.html'), 'utf8');

describe('HTML Parsing Library', () => {
  describe('htmlMinimalUISnapshot', () => {
    // Ported from CodeceptJS tests
    it('should cut out all non-interactive elements from GitHub HTML', async () => {
      const result = htmlMinimalUISnapshot(githubHtml);

      // Check that interactive elements are preserved
      expect(result).toContain('<input');
      expect(result).not.toContain("Let's build from here");
    });

    it('should keep interactive HTML elements', () => {
      const html = `
        <div id="onetrust-pc-sdk" class="otPcTab ot-hide ot-fade-in" lang="en" aria-label="Preference center" role="region">
        <div role="alertdialog" aria-modal="true" aria-describedby="ot-pc-desc" style="height: 100%;" aria-label="Privacy Preference Center">
        <!-- pc header --><div class="ot-pc-header" role="presentation">
        <div class="ot-title-cntr">
        <h2 id="ot-pc-title">Privacy Preference Center</h2>
        <div class="ot-close-cntr">
        <button id="close-pc-btn-handler" class="ot-close-icon" aria-label="Close"></button>
        </div>
        </div>
        </div>`;
      const result = htmlMinimalUISnapshot(html);
      expect(result).toContain('<button');
    });

    it('should keep menu bar', async () => {
      const html = `<div class="mainnav-menu-body">
      <ul>
        <li>
          <div class="flex">
            <button class="hamburger hamburger--arrowalt outline-none focus:outline-none" style="line-height: 0; margin-top: 3px; margin-bottom: 3px;" type="button">
              <span class="hamburger-box">
                <span class="hamburger-inner"></span>
              </span>
            </button>
          </div>
        </li>
        <li>
        <a id="ember6" class="ember-view flex items-center" href="/projects/codeceptjs-cucumber/runs" aria-describedby="ember7-popper">
          <svg class="md-icon md-icon-play-circle-outline" width="30" height="30" viewBox="0 0 24 24" role="img">
            <path d="aaaa">aaa</path>
          </svg>
        </a>
        </li>
      </ul>
    </div>`;
      const result = htmlMinimalUISnapshot(html);
      expect(result).toContain('<button');
      expect(result).toContain('<a');
      expect(result).toContain('<svg');
      expect(result).not.toContain('<path');
    });

    it('should cut out all non-interactive elements from HTML', () => {
      const result = htmlMinimalUISnapshot(checkoutHtml);
      expect(result).toContain('Name on card');
      expect(result).not.toContain('<script');
    });

    it('should allow adding new elements via CSS selector', () => {
      const html = '<div><h6>Hey</h6></div>';
      const result = htmlMinimalUISnapshot(html, { include: ['h6'] });
      expect(result).toContain('<h6>Hey</h6>');
    });

    it('should cut out all non-interactive elements from GitLab HTML', () => {
      const result = htmlMinimalUISnapshot(gitlabHtml);
      expect(result).toContain('Get free trial');
      expect(result).toContain('Sign in');
      expect(result).toContain('<button');
    });

    it('should cut out and minify Testomatio HTML', () => {
      const result = htmlMinimalUISnapshot(testomatHtml);
      expect(result).toContain('<svg class="md-icon md-icon-check-bold');
    });

    it('should strip script and style elements entirely', () => {
      const html = `
        <html>
          <head>
            <style>.hidden{display:none;}</style>
            <script>console.log('head');</script>
          </head>
          <body>
            <div>
              <script>console.log('body');</script>
              <style>.foo{color:red;}</style>
              <button>Checkout</button>
            </div>
          </body>
        </html>
      `;

      const result = htmlMinimalUISnapshot(html);

      expect(result).toContain('<button>Checkout</button>');
      expect(result).not.toContain('<script');
      expect(result).not.toContain('<style');
    });

    it('should strip tailwind utility classes while keeping custom ones', () => {
      const html = `
        <button class="bg-blue-500 flex items-center text-sm uppercase custom-link">
          Click me
        </button>
      `;

      const result = htmlMinimalUISnapshot(html);

      expect(result).toContain('class="custom-link"');
      expect(result).not.toContain('flex');
      expect(result).not.toContain('items-center');
      expect(result).not.toContain('text-sm');
      expect(result).not.toContain('uppercase');
    });

    it('should remove vector-only svg children while keeping structural wrappers', () => {
      const html = `
        <div>
          <button>
            <svg width="10" height="10">
              <defs></defs>
              <g><path d="m0 0" /></g>
            </svg>
            Menu
          </button>
        </div>
      `;

      const result = htmlMinimalUISnapshot(html);

      expect(result).toContain('<button');
      expect(result).toContain('Menu');
      expect(result).toContain('<svg');
      expect(result).not.toContain('<path');
      expect(result).not.toContain('<defs');
      expect(result).not.toContain('<g>');
    });
  });

  describe('htmlCombinedSnapshot', () => {
    it('should include both interactive elements and meaningful text', () => {
      const html = `
        <html>
          <body>
            <h1>Welcome to the site</h1>
            <p>This is a paragraph with enough text to be included in the snapshot.</p>
            <p>Short</p>
            <button>Click me</button>
            <div>
              <span>Another meaningful text element that should be included</span>
            </div>
          </body>
        </html>
      `;

      const result = htmlCombinedSnapshot(html);

      // Should keep interactive elements
      expect(result).toContain('<button');

      // Should keep meaningful text (≥5 chars)
      expect(result).toContain('Welcome to the site');
      expect(result).toContain('This is a paragraph');

      // Should remove short text
      expect(result).not.toContain('>Short<');
    });

    it('should truncate long text content', () => {
      const html = `
        <html>
          <body>
            <div>
              <p>${'a'.repeat(400)}</p>
            </div>
          </body>
        </html>
      `;

      const result = htmlCombinedSnapshot(html);
      const textContent = result.replace(/<[^>]*>/g, '').trim();

      // Text should remain intact for combined snapshot
      expect(textContent.length).toBeGreaterThanOrEqual(400);
      expect(textContent).not.toContain('...');
    });

    it('should clean head elements except title', () => {
      const html = `
        <html>
          <head>
            <title>Dashboard</title>
            <script>console.log('head');</script>
            <style>.header{}</style>
            <meta name="viewport" content="width=device-width">
            <link rel="stylesheet" href="style.css">
          </head>
          <body>
            <h1>Welcome</h1>
            <svg>
              <path d="m0 0"></path>
              <defs></defs>
            </svg>
          </body>
        </html>
      `;

      const result = htmlCombinedSnapshot(html);

      expect(result).toContain('<title>Dashboard</title>');
      expect(result).not.toContain('<style');
      expect(result).not.toContain('<script');
      expect(result).not.toContain('<meta');
      expect(result).not.toContain('<link');
      expect(result).not.toContain('<path');
      expect(result).not.toContain('<defs');
    });

    it('should remove script and iframe elements from combined snapshot body', () => {
      const html = `
        <html>
          <body>
            <div>Visible</div>
            <script>console.log('body');</script>
            <iframe src="/example"></iframe>
          </body>
        </html>
      `;

      const result = htmlCombinedSnapshot(html);

      expect(result).toContain('Visible');
      expect(result).not.toContain('<script');
      expect(result).not.toContain('<iframe');
    });

    it('should preserve extended interactive structure without truncating content', () => {
      const html = `
        <html lang="en" class="light">
          <head>
            <title>Company Settings - Testomat.io</title>
            <script src="/assets/head.js"></script>
          </head>
          <body>
            <div id="content-desktop" class="user">
              <div class="auth-header-nav">
                <div class="auth-header-nav-left-items">
                  <a href="/">Dashboard</a>
                  <a href="/companies">Companies</a>
                </div>
                <div class="auth-header-nav-right">
                  <a class="auth-header-nav-right-icon-button" href="/projects/new">New Project</a>
                  <button id="showGlobalSearchBtn">Search</button>
                  <div class="auth-header-nav-right-dropdown" x-data="{ open: false }">
                    <div id="profile-menu" role="menu" aria-labelledby="user-menu-button">
                      <div class="auth-header-nav-right-dropdown-menu-block">
                        <div class="auth-header-nav-right-dropdown-menu-block-signed-as">Signed in as</div>
                        <div class="auth-header-nav-right-dropdown-menu-block-email">user@example.com</div>
                      </div>
                      <div class="auth-header-nav-right-dropdown-menu-block">
                        <a href="/account">Account</a>
                        <a href="/account/files">Downloads</a>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </body>
        </html>
      `;

      const result = htmlCombinedSnapshot(html);

      expect(result).toContain('Dashboard');
      expect(result).toContain('Companies');
      expect(result).toContain('Signed in as');
      expect(result).toContain('Downloads');
    });
  });

  describe('htmlTextSnapshot', () => {
    it('should convert HTML to markdown text', () => {
      const html = `
        <html>
          <body>
            <div>
              <h1>Main Title</h1>
              <p>This is a paragraph with enough text to be included.</p>
              <ul>
                <li>First item</li>
                <li>Second item</li>
              </ul>
              <label>Email:</label>
              <input type="email">
              <p>More text here</p>
            </div>
          </body>
        </html>
      `;

      const result = htmlTextSnapshot(html);

      expect(result).toContain('# Main Title');
      expect(result).toContain('This is a paragraph with enough text to be included.');
      expect(result).toContain('- First item');
      expect(result).toContain('- Second item');
      expect(result).toContain('**Email:**');
      expect(result).toContain('More text here');

      // Should not contain HTML tags
      expect(result).not.toContain('<h1>');
      expect(result).not.toContain('<p>');
      expect(result).not.toContain('<input>');
    });

    it('should skip text shorter than 5 characters', () => {
      const html = `
        <html>
          <body>
            <div>
              <h1>Long title</h1>
              <p>Ok</p>
              <p>This is long enough</p>
              <span>Hi</span>
            </div>
          </body>
        </html>
      `;

      const result = htmlTextSnapshot(html);

      expect(result).toContain('# Long title');
      expect(result).toContain('This is long enough');
      expect(result).not.toContain('Ok');
      expect(result).not.toContain('Hi');
    });
  });
});
