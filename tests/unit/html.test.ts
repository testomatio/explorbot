import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  htmlMinimalUISnapshot,
  htmlCombinedSnapshot,
  htmlTextSnapshot,
} from '../../src/utils/html.ts';

// Load test HTML files
const githubHtml = readFileSync(
  join(process.cwd(), 'test/data/github.html'),
  'utf8'
);

const gitlabHtml = readFileSync(
  join(process.cwd(), 'test/data/gitlab.html'),
  'utf8'
);

const testomatHtml = readFileSync(
  join(process.cwd(), 'test/data/testomat.html'),
  'utf8'
);

const checkoutHtml = readFileSync(
  join(process.cwd(), 'test/data/checkout.html'),
  'utf8'
);

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

      // Text should be truncated to ~300 chars
      expect(textContent.length).toBeLessThanOrEqual(303); // 300 + "..."
      expect(textContent).toContain('...');
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
      expect(result).toContain(
        'This is a paragraph with enough text to be included.'
      );
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
