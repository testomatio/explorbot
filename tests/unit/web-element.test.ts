import { describe, expect, it } from 'bun:test';
import { JSDOM } from 'jsdom';
import { extractElementData } from '../../src/utils/web-element.ts';

describe('extractElementData', () => {
  it('adds context, area, and variant hints for component drilling', () => {
    const dom = new JSDOM(`
      <main>
        <article>
          <h2>Toggle - off</h2>
          <button role="switch" aria-label="Enable feature" aria-checked="false" class="primary-btn btn-md"></button>
        </article>
      </main>
    `);
    useDom(dom);
    const button = dom.window.document.querySelector('button')!;
    mockVisibleBox(button);

    const data = extractElementData(button);

    expect(data?.allAttrs['data-explorbot-context']).toBe('Toggle - off');
    expect(data?.allAttrs['data-explorbot-area']).toContain('main');
    expect(data?.allAttrs['data-explorbot-area']).toContain('role:switch');
    expect(data?.allAttrs['data-explorbot-variant']).toContain('primary-btn');
    expect(data?.allAttrs['data-explorbot-variant']).toContain('btn-md');
    expect(data?.outerHTML).toContain('aria-checked="false"');
  });

  it('marks embedded code editor iframes', () => {
    const dom = new JSDOM(`
      <main>
        <article>
          <h2>Code Input</h2>
          <div class="editor-shell">
            <iframe src="/ember-monaco/frame.html" data-explorbot-frame-source-index="1"></iframe>
          </div>
        </article>
      </main>
    `);
    useDom(dom);
    const frame = dom.window.document.querySelector('iframe')!;
    mockVisibleBox(frame);

    const data = extractElementData(frame);

    expect(data?.allAttrs['data-explorbot-context']).toBe('Code Input');
    expect(data?.allAttrs['data-explorbot-variant']).toContain('iframe');
    expect(data?.allAttrs['data-explorbot-variant']).toContain('code-editor');
    expect(data?.allAttrs['data-explorbot-frame-source-index']).toBe('1');
  });
});

function useDom(dom: JSDOM) {
  (globalThis as any).window = dom.window;
  (globalThis as any).document = dom.window.document;
}

function mockVisibleBox(element: Element) {
  element.getBoundingClientRect = () => ({
    x: 10,
    y: 20,
    width: 100,
    height: 30,
    top: 20,
    left: 10,
    right: 110,
    bottom: 50,
    toJSON: () => ({}),
  });
  (element as HTMLElement).style.position = 'fixed';
}
