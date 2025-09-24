import { describe, it, expect } from 'vitest';
import { htmlDiff } from '../../src/utils/html-diff.ts';

describe('HTML Diff', () => {
  it('should detect no changes in identical HTML', () => {
    const html1 = `
      <html>
        <body>
          <h1>Welcome</h1>
          <p>This is a test paragraph.</p>
        </body>
      </html>
    `;

    const html2 = `
      <html>
        <body>
          <h1>Welcome</h1>
          <p>This is a test paragraph.</p>
        </body>
      </html>
    `;

    const result = htmlDiff(html1, html2);

    expect(result.similarity).toBe(100);
    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
    expect(result.summary).toBe('No changes detected');
  });

  it('should detect added text content', () => {
    const html1 = `
      <html>
        <body>
          <h1>Welcome</h1>
          <p>This is a test.</p>
        </body>
      </html>
    `;

    const html2 = `
      <html>
        <body>
          <h1>Welcome</h1>
          <p>This is a test paragraph.</p>
          <button>Click me</button>
        </body>
      </html>
    `;

    const result = htmlDiff(html1, html2);

    expect(result.similarity).toBeLessThan(100);
    expect(result.added).toContain('TEXT:This is a test paragraph.');
    expect(result.added).toContain('BUTTON:Click me');
    expect(result.removed).toContain('TEXT:This is a test.');
  });

  it('should detect removed elements', () => {
    const html1 = `
      <html>
        <body>
          <h1>Welcome</h1>
          <p>This is a test.</p>
          <a href="/login">Login</a>
        </body>
      </html>
    `;

    const html2 = `
      <html>
        <body>
          <h1>Welcome</h1>
          <p>This is a test.</p>
        </body>
      </html>
    `;

    const result = htmlDiff(html1, html2);

    expect(result.similarity).toBeLessThan(100);
    expect(result.removed).toContain('A:Login');
    expect(result.added).toHaveLength(0);
  });

  it('should detect form field changes', () => {
    const html1 = `
      <form>
        <input type="text" name="username" placeholder="Enter username">
        <button>Submit</button>
      </form>
    `;

    const html2 = `
      <form>
        <input type="email" name="email" placeholder="Enter email">
        <input type="password" name="password" placeholder="Enter password">
        <button>Login</button>
      </form>
    `;

    const result = htmlDiff(html1, html2);

    expect(result.similarity).toBeLessThan(100);
    expect(result.added).toContain('INPUT:Enter password');
    expect(result.removed).toContain('INPUT:Enter username');
  });

  it('should handle HTML fragments', () => {
    const html1 = '<div>Hello world</div>';
    const html2 = '<div>Hello world <span>extra</span></div>';

    const result = htmlDiff(html1, html2);

    expect(result.similarity).toBeLessThan(100);
    expect(result.added.length).toBeGreaterThan(0);
  });

  it('should calculate similarity percentage correctly', () => {
    const html1 = `
      <html>
        <body>
          <h1>Title</h1>
          <p>Paragraph 1</p>
          <p>Paragraph 2</p>
          <p>Paragraph 3</p>
        </body>
      </html>
    `;

    const html2 = `
      <html>
        <body>
          <h1>Title</h1>
          <p>Paragraph 1</p>
          <p>Modified paragraph</p>
          <p>Paragraph 4</p>
        </body>
      </html>
    `;

    const result = htmlDiff(html1, html2);

    // Should be around 33% similar (2 matching out of 6 total unique items)
    expect(result.similarity).toBeGreaterThan(30);
    expect(result.similarity).toBeLessThan(40);
  });
});
