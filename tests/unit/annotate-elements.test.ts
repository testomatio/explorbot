import { describe, expect, it } from 'bun:test';
import { annotatePageElements } from '../../src/explorer.ts';

function createMockPage(ariaSnapshot: string, roleElements: Record<string, any[]>) {
  return {
    locator: () => ({
      ariaSnapshot: async () => ariaSnapshot,
    }),
    getByRole: (role: string) => ({
      evaluateAll: async (_fn: (...a: any[]) => any, args: any[]) => {
        const elements = roleElements[role] || [];
        const [data] = args;
        const results: any[] = [];
        for (let i = 0; i < elements.length && i < data.length; i++) {
          elements[i].setAttribute('data-explorbot-eidx', data[i].ref);
          results.push(elements[i].extractData());
        }
        return results;
      },
    }),
  };
}

function createMockElement(tag: string, attrs: Record<string, string>, text = '') {
  const allAttrs = { ...attrs };
  return {
    setAttribute(name: string, value: string) {
      allAttrs[name] = value;
    },
    extractData() {
      return {
        tag,
        text,
        allAttrs: { ...allAttrs },
        x: 100,
        y: 200,
      };
    },
  };
}

describe('annotatePageElements', () => {
  it('parses ARIA snapshot and returns elements with roles', async () => {
    const ariaSnapshot = ['- button "Submit" [ref=e1]', '- link "Home" [ref=e2]', '- textbox "Email" [ref=e3]'].join('\n');

    const page = createMockPage(ariaSnapshot, {
      button: [createMockElement('button', { type: 'submit' }, 'Submit')],
      link: [createMockElement('a', { href: '/' }, 'Home')],
      textbox: [createMockElement('input', { type: 'email', name: 'email' })],
    });

    const result = await annotatePageElements(page);

    expect(result.ariaSnapshot).toBe(ariaSnapshot);
    expect(result.elements).toHaveLength(3);
    expect(result.elements[0].role).toBe('button');
    expect(result.elements[1].role).toBe('link');
    expect(result.elements[2].role).toBe('textbox');
  });

  it('handles multiple elements of the same role', async () => {
    const ariaSnapshot = ['- button "Save" [ref=e1]', '- button "Cancel" [ref=e2]'].join('\n');

    const page = createMockPage(ariaSnapshot, {
      button: [createMockElement('button', {}, 'Save'), createMockElement('button', {}, 'Cancel')],
    });

    const result = await annotatePageElements(page);

    expect(result.elements).toHaveLength(2);
    expect(result.elements[0].role).toBe('button');
    expect(result.elements[1].role).toBe('button');
  });

  it('skips non-annotatable roles', async () => {
    const ariaSnapshot = ['- heading "Title" [ref=e1]', '- button "OK" [ref=e2]', '- paragraph "text" [ref=e3]'].join('\n');

    const page = createMockPage(ariaSnapshot, {
      button: [createMockElement('button', {}, 'OK')],
    });

    const result = await annotatePageElements(page);

    expect(result.elements).toHaveLength(1);
    expect(result.elements[0].role).toBe('button');
  });

  it('returns empty elements for empty ARIA snapshot', async () => {
    const page = createMockPage('', {});
    const result = await annotatePageElements(page);

    expect(result.ariaSnapshot).toBe('');
    expect(result.elements).toHaveLength(0);
  });

  it('handles all annotatable roles', async () => {
    const ariaSnapshot = ['- button "Btn" [ref=e1]', '- link "Lnk" [ref=e2]', '- checkbox "Chk" [ref=e3]', '- radio "Rad" [ref=e4]', '- combobox "Cmb" [ref=e5]', '- tab "Tab1" [ref=e6]', '- menuitem "Menu" [ref=e7]', '- switch "Sw" [ref=e8]'].join('\n');

    const page = createMockPage(ariaSnapshot, {
      button: [createMockElement('button', {}, 'Btn')],
      link: [createMockElement('a', { href: '#' }, 'Lnk')],
      checkbox: [createMockElement('input', { type: 'checkbox' })],
      radio: [createMockElement('input', { type: 'radio' })],
      combobox: [createMockElement('select', {})],
      tab: [createMockElement('div', { role: 'tab' }, 'Tab1')],
      menuitem: [createMockElement('div', { role: 'menuitem' }, 'Menu')],
      switch: [createMockElement('button', { role: 'switch' })],
    });

    const result = await annotatePageElements(page);

    expect(result.elements).toHaveLength(8);
    const roles = result.elements.map((e) => e.role);
    expect(roles).toContain('button');
    expect(roles).toContain('link');
    expect(roles).toContain('checkbox');
    expect(roles).toContain('radio');
    expect(roles).toContain('combobox');
    expect(roles).toContain('tab');
    expect(roles).toContain('menuitem');
    expect(roles).toContain('switch');
  });

  it('gracefully handles evaluateAll failure', async () => {
    const ariaSnapshot = '- button "Fail" [ref=e1]';

    const page = {
      locator: () => ({
        ariaSnapshot: async () => ariaSnapshot,
      }),
      getByRole: () => ({
        evaluateAll: async () => {
          throw new Error('DOM detached');
        },
      }),
    };

    const result = await annotatePageElements(page);

    expect(result.ariaSnapshot).toBe(ariaSnapshot);
    expect(result.elements).toHaveLength(0);
  });

  describe('component metadata', () => {
    let page: Page;
    let elements: WebElement[];

    beforeAll(async () => {
      page = await browser.newPage();
      await page.setContent(`
        <main>
          <article class="FreestyleUsage">
            <h2 class="FreestyleUsage-title">Toggle - off</h2>
            <button role="switch" aria-label="Enable feature" aria-checked="false" class="flex-shrink-0 rounded-full h-5 w-10 cursor-pointer"></button>
          </article>
          <article class="FreestyleUsage">
            <h2 class="FreestyleUsage-title">Code Input</h2>
            <iframe src="/ember-monaco/frame.html"></iframe>
          </article>
        </main>
      `);
      const result = await annotatePageElements(page);
      elements = result.elements;
    });

    afterAll(async () => {
      await page?.close();
    });

    it('adds context and variant hints for drillable controls', () => {
      const toggle = elements.find((el) => el.role === 'switch');
      expect(toggle?.contextLabel).toBe('Toggle - off');
      expect(toggle?.areaHints).toContain('role:switch');
      expect(toggle?.areaHints).toContain('main');
      expect(toggle?.outerHTML).toContain('aria-checked="false"');
    });

    it('annotates code editor iframes for driller discovery', () => {
      const frame = elements.find((el) => el.role === 'iframe');
      expect(frame?.contextLabel).toBe('Code Input');
      expect(frame?.variantHints).toContain('iframe');
      expect(frame?.variantHints).toContain('code-editor');
      expect(frame?.attrs['data-explorbot-frame-source-index']).toBe('1');
    });
  });
});
