import { afterEach, describe, expect, it } from 'bun:test';
import { JSDOM } from 'jsdom';
import { WebElement, extractElementData } from '../../src/utils/web-element.ts';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');

afterEach(() => {
  restoreGlobal('window', originalWindow);
  restoreGlobal('document', originalDocument);
});

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
    expect(data?.allAttrs['data-explorbot-hit']).toBe('target');
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

  it('marks visible elements covered by another UI layer', () => {
    const dom = new JSDOM(`
      <main>
        <input aria-label="Suite name" />
        <aside role="dialog" aria-label="Navigation drawer"></aside>
      </main>
    `);
    useDom(dom);
    const input = dom.window.document.querySelector('input')!;
    const aside = dom.window.document.querySelector('aside')!;
    mockVisibleBox(input);
    mockVisibleBox(aside);
    dom.window.document.elementFromPoint = () => aside;

    const data = extractElementData(input);

    expect(data?.allAttrs['data-explorbot-hit']).toBe('covered');
    expect(data?.allAttrs['data-explorbot-covered-by']).toContain('aside');
    expect(data?.allAttrs['data-explorbot-covered-by']).toContain('role="dialog"');
  });
});

describe('WebElement', () => {
  it('reads internal explorbot attributes by logical name', () => {
    const element = new WebElement({
      tag: 'input',
      xpath: '',
      clickXPath: '',
      attrs: {
        'data-explorbot-hit': 'covered',
        'data-explorbot-covered-by': 'aside[role="dialog"]',
      },
      text: '',
      x: 10,
      y: 20,
    });

    expect(element.ourAttr('hit')).toBe('covered');
    expect(element.ourAttr('coveredBy')).toBe('aside[role="dialog"]');
  });
});

describe('WebElement.commonAncestor', () => {
  it('returns the closest wrapper containing all elements', async () => {
    const dom = new JSDOM(`
      <main>
        <div class="detail detail-view-resizable">
          <button data-explorbot-eidx="e1">Save</button>
          <span><a data-explorbot-eidx="e2" href="/cancel">Cancel</a></span>
        </div>
      </main>
    `);
    useDom(dom);
    const wrapper = dom.window.document.querySelector('.detail')!;
    mockVisibleBox(wrapper);

    const ancestor = await WebElement.commonAncestor(fakePage(), ['e1', 'e2']);

    expect(ancestor?.tag).toBe('div');
    expect(ancestor?.filteredClasses).toContain('detail-view-resizable');
  });

  it('returns null for a single element', async () => {
    const dom = new JSDOM(`
      <main>
        <div class="panel"><button data-explorbot-eidx="e1">Save</button></div>
      </main>
    `);
    useDom(dom);

    expect(await WebElement.commonAncestor(fakePage(), ['e1'])).toBeNull();
    expect(await WebElement.commonAncestor(fakePage(), ['e1', 'e404'])).toBeNull();
  });

  it('returns null when elements only share the body', async () => {
    const dom = new JSDOM(`
      <header><button data-explorbot-eidx="e1">Save</button></header>
      <footer><button data-explorbot-eidx="e2">Cancel</button></footer>
    `);
    useDom(dom);

    expect(await WebElement.commonAncestor(fakePage(), ['e1', 'e2'])).toBeNull();
  });
});

function fakePage() {
  return { evaluate: async (fn: (arg: any) => any, arg: any) => fn(arg) };
}

function restoreGlobal(name: string, descriptor: PropertyDescriptor | undefined) {
  if (!descriptor) {
    delete (globalThis as any)[name];
    return;
  }
  Object.defineProperty(globalThis, name, descriptor);
}

function useDom(dom: JSDOM) {
  (globalThis as any).window = dom.window;
  (globalThis as any).document = dom.window.document;
  Object.defineProperty(dom.window, 'innerWidth', { configurable: true, value: 1280 });
  Object.defineProperty(dom.window, 'innerHeight', { configurable: true, value: 720 });
  dom.window.document.elementFromPoint = () => null;
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
  const originalElementFromPoint = element.ownerDocument.elementFromPoint;
  element.ownerDocument.elementFromPoint = (x: number, y: number) => {
    const rect = element.getBoundingClientRect();
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return element;
    return originalElementFromPoint.call(element.ownerDocument, x, y);
  };
}
