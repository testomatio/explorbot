import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractTargetedHtml, htmlCombinedSnapshot, htmlMinimalUISnapshot, htmlTextSnapshot, isBodyEmpty } from '../../src/utils/html.ts';

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

    it('should preserve iframe elements as interactive elements', () => {
      const html = `
        <div>
          <h1>Video Player</h1>
          <iframe src="https://example.com/video" width="560" height="315" frameborder="0"></iframe>
          <button>Play</button>
        </div>
      `;

      const result = htmlMinimalUISnapshot(html);

      expect(result).toContain('<iframe');
      expect(result).toContain('src="https://example.com/video"');
      expect(result).toContain('width="560"');
      expect(result).toContain('height="315"');
      expect(result).toContain('<button');
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

    it('should remove script elements but preserve iframe elements from combined snapshot body', () => {
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
      expect(result).toContain('<iframe');
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

    it('should preserve iframe elements in combined snapshot', () => {
      const html = `
        <html>
          <body>
            <h1>Embedded Content</h1>
            <p>This page contains embedded content below.</p>
            <iframe src="https://example.com/embed" width="800" height="600" title="Example Embed"></iframe>
            <div>Additional content after iframe</div>
          </body>
        </html>
      `;

      const result = htmlCombinedSnapshot(html);

      expect(result).toContain('<iframe');
      expect(result).toContain('src="https://example.com/embed"');
      expect(result).not.toContain('width="800"');
      expect(result).not.toContain('height="600"');
      expect(result).toContain('title="Example Embed"');
      expect(result).toContain('Embedded Content');
      expect(result).toContain('Additional content after iframe');
    });

    it('should preserve input elements with role=combobox in parent containers with empty text', () => {
      const html = `
        <html>
          <head><title>Test</title></head>
          <body>
            <div class="wrapper">
              <input role="combobox" id="test-combo" placeholder="Title should not be empty" type="search">
            </div>
          </body>
        </html>
      `;

      const result = htmlCombinedSnapshot(html);

      expect(result).toContain('<input');
      expect(result).toContain('role="combobox"');
      expect(result).toContain('placeholder="Title should not be empty"');
    });

    it('should preserve iframe in parent containers with empty text', () => {
      const html = `
        <html>
          <head><title>Test</title></head>
          <body>
            <div class="editor-wrapper">
              <div class="monaco-editor">
                <div class="frame-container">
                  <iframe src="/ember-monaco/frame.html"></iframe>
                </div>
              </div>
            </div>
          </body>
        </html>
      `;

      const result = htmlCombinedSnapshot(html);

      expect(result).toContain('<iframe');
      expect(result).toContain('src="/ember-monaco/frame.html"');
    });

    it('should keep interactive elements even when parent div has no meaningful text', () => {
      const html = `
        <html>
          <body>
            <div>
              <div>
                <button>Click Me</button>
              </div>
            </div>
            <div>
              <span>
                <input type="text" placeholder="Enter name">
              </span>
            </div>
          </body>
        </html>
      `;

      const result = htmlCombinedSnapshot(html);

      expect(result).toContain('<button');
      expect(result).toContain('Click Me');
      expect(result).toContain('<input');
      expect(result).toContain('placeholder="Enter name"');
    });

    it('should remove empty divs that do not contain interactive elements', () => {
      const html = `
        <html>
          <body>
            <div class="wrapper">
              <div class="empty1"></div>
              <div class="empty2">   </div>
              <div class="has-button">
                <button>Submit</button>
              </div>
              <div class="short">AB</div>
            </div>
          </body>
        </html>
      `;

      const result = htmlCombinedSnapshot(html);

      expect(result).toContain('<button');
      expect(result).toContain('Submit');
      expect(result).not.toContain('empty1');
      expect(result).not.toContain('empty2');
      expect(result).not.toContain('>AB<');
    });

    it('should convert data-explorbot-* attributes to regular attributes', () => {
      const html = `
        <html>
          <body>
            <div data-explorbot-id="main-section">
              <input data-explorbot-value="test-input" placeholder="Enter text" type="text">
            </div>
            <button data-explorbot-action="submit">Submit</button>
            <span data-explorbot-label="info">Some info text here</span>
          </body>
        </html>
      `;

      const result = htmlCombinedSnapshot(html);

      expect(result).not.toContain('data-explorbot-');
      expect(result).toContain('id="main-section"');
      expect(result).toContain('value="test-input"');
      expect(result).toContain('action="submit"');
      expect(result).toContain('label="info"');
    });

    it('should preserve elements with data-explorbot-* attributes even if they would normally be filtered', () => {
      const html = `
        <html>
          <body>
            <div>
              <span data-explorbot-key="special">AB</span>
            </div>
            <p data-explorbot-important="true">Hi</p>
          </body>
        </html>
      `;

      const result = htmlCombinedSnapshot(html);

      expect(result).toContain('key="special"');
      expect(result).toContain('>AB<');
      expect(result).toContain('important="true"');
      expect(result).toContain('>Hi<');
    });

    it('should filter out elements with hidden classes', () => {
      const html = `
        <html>
          <body>
            <button class="hidden">Hidden Button</button>
            <button class="visible">Visible Button</button>
            <div class="invisible">
              <input type="text" placeholder="Hidden input">
            </div>
            <div class="d-none">
              <a href="/link">Hidden Link</a>
            </div>
            <span class="sr-only">Screen reader only</span>
            <p class="opacity-0">Invisible text</p>
            <button class="hide">Old style hidden</button>
          </body>
        </html>
      `;

      const result = htmlCombinedSnapshot(html);

      expect(result).toContain('Visible Button');
      expect(result).not.toContain('Hidden Button');
      expect(result).not.toContain('Hidden input');
      expect(result).not.toContain('Hidden Link');
      expect(result).not.toContain('Screen reader only');
      expect(result).not.toContain('Invisible text');
      expect(result).not.toContain('Old style hidden');
    });

    it('should filter elements with Bootstrap and Tailwind hidden classes', () => {
      const html = `
        <html>
          <body>
            <div class="d-none">Bootstrap hidden</div>
            <div class="dn">Tachyons hidden</div>
            <div class="u-hidden">Utility hidden</div>
            <div class="is-hidden">BEM hidden</div>
            <div class="visually-hidden">Visually hidden</div>
            <div class="visuallyhidden">Visually hidden alt</div>
            <div>Visible content</div>
          </body>
        </html>
      `;

      const result = htmlCombinedSnapshot(html);

      expect(result).toContain('Visible content');
      expect(result).not.toContain('Bootstrap hidden');
      expect(result).not.toContain('Tachyons hidden');
      expect(result).not.toContain('Utility hidden');
      expect(result).not.toContain('BEM hidden');
      expect(result).not.toContain('Visually hidden');
    });

    it('should preserve all children of elements with role attribute and clean Tailwind classes', () => {
      const html = `
        <html>
          <body>
            <div class="ember-basic-dropdown power-select-as-input power-select-as-input-single black mb-4">
              <div class="ember-view ember-basic-dropdown-trigger flex items-center" role="button" tabindex="0" aria-owns="ember676-content">
                <span class="ember-power-select-selected-item text-sm font-bold">test</span>
                <span class="ember-power-select-status-icon ml-2"></span>
              </div>
            </div>
          </body>
        </html>
      `;

      const result = htmlCombinedSnapshot(html);

      expect(result).toContain('role="button"');
      expect(result).toContain('tabindex="0"');
      expect(result).toContain('aria-owns="ember676-content"');
      expect(result).toContain('<span');
      expect(result).toContain('test');
      expect(result).toContain('ember-power-select-selected-item');
      expect(result).toContain('ember-power-select-status-icon');
      expect(result).not.toContain('text-sm');
      expect(result).not.toContain('font-bold');
      expect(result).not.toContain('ml-2');
      expect(result).not.toContain('flex');
      expect(result).not.toContain('items-center');
      expect(result).not.toContain('mb-4');
    });

    it('should preserve all children of button elements', () => {
      const html = `
        <html>
          <body>
            <button class="btn btn-primary bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">
              <svg class="w-4 h-4 mr-2"><path d="M0 0"/></svg>
              <span class="label">Click</span>
            </button>
          </body>
        </html>
      `;

      const result = htmlCombinedSnapshot(html);

      expect(result).toContain('<button');
      expect(result).toContain('<svg');
      expect(result).toContain('<span');
      expect(result).toContain('Click');
      expect(result).toContain('class="btn btn-primary"');
      expect(result).not.toContain('bg-blue-500');
      expect(result).not.toContain('hover:bg-blue-700');
      expect(result).not.toContain('text-white');
      expect(result).not.toContain('font-bold');
      expect(result).not.toContain('py-2');
      expect(result).not.toContain('px-4');
      expect(result).not.toContain('rounded');
      expect(result).not.toContain('w-4');
      expect(result).not.toContain('h-4');
      expect(result).not.toContain('mr-2');
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

  describe('isBodyEmpty', () => {
    it('should return true for empty html', () => {
      expect(isBodyEmpty('')).toBe(true);
    });

    it('should return true for null/undefined html', () => {
      expect(isBodyEmpty(null as any)).toBe(true);
      expect(isBodyEmpty(undefined as any)).toBe(true);
    });

    it('should return true when body tag is missing', () => {
      const html = '<html><head><title>Test</title></head></html>';
      expect(isBodyEmpty(html)).toBe(true);
    });

    it('should return true when body is empty', () => {
      const html = '<html><body></body></html>';
      expect(isBodyEmpty(html)).toBe(true);
    });

    it('should return true when body contains only whitespace', () => {
      const html = '<html><body>   \n\t  </body></html>';
      expect(isBodyEmpty(html)).toBe(true);
    });

    it('should return false when body contains content', () => {
      const html = '<html><body><div>Content</div></body></html>';
      expect(isBodyEmpty(html)).toBe(false);
    });

    it('should return false when body contains text', () => {
      const html = '<html><body>Hello World</body></html>';
      expect(isBodyEmpty(html)).toBe(false);
    });

    it('should handle body with attributes', () => {
      const html = '<html><body class="main" id="page-body"></body></html>';
      expect(isBodyEmpty(html)).toBe(true);
    });

    it('should handle body with attributes and content', () => {
      const html = '<html><body class="main"><p>Text</p></body></html>';
      expect(isBodyEmpty(html)).toBe(false);
    });

    it('should handle multiline body content', () => {
      const html = `<html>
        <body>
          <div>
            <p>Content here</p>
          </div>
        </body>
      </html>`;
      expect(isBodyEmpty(html)).toBe(false);
    });

    it('should handle case-insensitive body tag', () => {
      const html = '<html><BODY>Content</BODY></html>';
      expect(isBodyEmpty(html)).toBe(false);
    });
  });

  describe('extractTargetedHtml', () => {
    it('should return empty string for empty inputs', () => {
      expect(extractTargetedHtml('', 'button')).toBe('');
      expect(extractTargetedHtml('<div>test</div>', '')).toBe('');
    });

    it('should extract HTML snippet by text locator', () => {
      const html = '<div><button class="primary">Submit</button><span>Other</span></div>';
      const result = extractTargetedHtml(html, 'Submit');

      expect(result).toContain('Submit');
      expect(result).toContain('<button');
    });

    it('should extract HTML snippet by class selector', () => {
      const html = '<div><button class="btn-primary submit-btn">Click me</button></div>';
      const result = extractTargetedHtml(html, '.btn-primary');

      expect(result).toContain('btn-primary');
      expect(result).toContain('<button');
    });

    it('should extract HTML snippet by id selector', () => {
      const html = '<div><input id="username" type="text" placeholder="Enter username"></div>';
      const result = extractTargetedHtml(html, '#username');

      expect(result).toContain('id="username"');
      expect(result).toContain('<input');
    });

    it('should extract HTML snippet by XPath text locator', () => {
      const html = '<div><a href="/login">Sign In</a><button>Cancel</button></div>';
      const result = extractTargetedHtml(html, '//a[text()="Sign In"]');

      expect(result).toContain('Sign In');
      expect(result).toContain('<a');
    });

    it('should extract HTML snippet by XPath attribute locator', () => {
      const html = '<div><button data-testid="close-btn">X</button></div>';
      const result = extractTargetedHtml(html, '//*[@data-testid="close-btn"]');

      expect(result).toContain('close-btn');
      expect(result).toContain('<button');
    });

    it('should extract HTML snippet by JSON locator with text', () => {
      const html = '<div><span role="button">Delete</span></div>';
      const result = extractTargetedHtml(html, '{"text":"Delete"}');

      expect(result).toContain('Delete');
      expect(result).toContain('<span');
    });

    it('should extract HTML snippet by JSON locator with name', () => {
      const html = '<div><input name="email" type="email"></div>';
      const result = extractTargetedHtml(html, '{"name":"email"}');

      expect(result).toContain('name="email"');
      expect(result).toContain('<input');
    });

    it('should return empty string when locator not found', () => {
      const html = '<div><button>Submit</button></div>';
      const result = extractTargetedHtml(html, 'Cancel');

      expect(result).toBe('');
    });

    it('should skip single-character search terms', () => {
      const html = '<div><button>A</button></div>';
      const result = extractTargetedHtml(html, 'A');

      expect(result).toBe('');
    });

    it('should extract nested elements correctly', () => {
      const html = '<form><div class="field"><label>Email</label><input type="email"></div></form>';
      const result = extractTargetedHtml(html, 'Email');

      expect(result).toContain('Email');
      expect(result).toContain('<label');
    });

    it('should handle multiple XPath attribute matches', () => {
      const html = '<div><input type="text" name="username" placeholder="Enter name"></div>';
      const result = extractTargetedHtml(html, '//input[@name="username"][@type="text"]');

      expect(result).toContain('username');
      expect(result).toContain('<input');
    });

    it('should handle grouped XPath locators', () => {
      const html = '<div><a href="/page">First Link</a><a href="/other">Second Link</a></div>';
      const result = extractTargetedHtml(html, '(//a[text()="First Link"])[1]');

      expect(result).toContain('First Link');
      expect(result).toContain('<a');
    });

    it('should limit snippet length to prevent excessive output', () => {
      const longContent = 'x'.repeat(1000);
      const html = `<div class="wrapper"><p>${longContent}</p></div>`;
      const result = extractTargetedHtml(html, '.wrapper');

      expect(result.length).toBeLessThanOrEqual(500);
    });
  });
});
