import { describe, expect, it } from 'vitest';
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
    expect(result.subtree).toBe('');
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
    expect(result.subtree).toContain('<html');
    expect(result.subtree).toContain('<body>');
    expect(result.subtree).toContain('<button>Click me</button>');
  });

  it('should detect removed elements without subtree', () => {
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
    expect(result.subtree).toBe('');
  });

  it('should detect form field changes and additions', () => {
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
    expect(result.subtree).toContain('type="password"');
    expect(result.subtree).not.toContain('<button>Login</button>');
    expect(result.added).toContain('ELEMENT:html[1]/body[1]/form[1]/input[2]');
    expect(result.added).toContain('BUTTON:Login');
  });

  it('should handle HTML fragments', () => {
    const html1 = '<div>Hello world</div>';
    const html2 = '<div>Hello world <span>extra</span></div>';

    const result = htmlDiff(html1, html2);

    expect(result.similarity).toBeLessThan(100);
    expect(result.added.length).toBeGreaterThan(0);
    expect(result.subtree).toContain('<span>extra</span>');
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

    expect(result.similarity).toBeGreaterThan(30);
    expect(result.similarity).toBeLessThan(40);
    expect(result.subtree).toBe('');
  });

  it('should retain ancestors for nested additions', () => {
    const original = `
      <ul>
        <li>First item</li>
      </ul>
    `;

    const modified = `
      <ul>
        <li>First item</li>
        <li>Second item</li>
      </ul>
    `;

    const result = htmlDiff(original, modified);

    expect(result.subtree).toContain('<html');
    expect(result.subtree).toContain('<body>');
    expect(result.subtree).toContain('<ul>');
    expect(result.subtree).toContain('<li>Second item</li>');
    expect(result.subtree).not.toContain('First item');
  });

  it('should capture text-only changes', () => {
    const original = '<button>Submit</button>';
    const modified = '<button>Confirm</button>';

    const result = htmlDiff(original, modified);

    expect(result.subtree).toBe('');
    expect(result.added).toContain('BUTTON:Confirm');
    expect(result.removed).toContain('BUTTON:Submit');
  });

  it('should sanitize scripts and non-semantic nodes from diff output', () => {
    const original = `
      <html>
        <body>
          <div>Base</div>
        </body>
      </html>
    `;

    const modified = `
      <html>
        <body>
          <div>Base</div>
          <script>alert('xss');</script>
          <iframe src="/test"></iframe>
          <svg><path d="m0 0"></path></svg>
        </body>
      </html>
    `;

    const result = htmlDiff(original, modified);

    expect(result.subtree).not.toContain('<script');
    expect(result.subtree).not.toContain('<iframe');
    expect(result.subtree).not.toContain('<path');
    expect(result.subtree).not.toContain('<script');
    expect(result.subtree).not.toContain('<iframe');
    expect(result.subtree).toContain('<svg');
    expect(result.added).toContain('ELEMENT:html[1]/body[1]/svg[1]');
    expect(result.summary).toContain('addition');
  });
});
