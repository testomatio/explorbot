import { describe, expect, it } from 'bun:test';
import { buildCanonicalClickCode, formatExperienceTitle } from '../../src/ai/driller.ts';

describe('buildCanonicalClickCode', () => {
  it('returns empty code for links', () => {
    const code = buildCanonicalClickCode(createComponent({ tag: 'a' }));
    expect(code).toBe('');
  });

  it('builds semantic xpath click when role and aria-label are available', () => {
    const code = buildCanonicalClickCode(
      createComponent({
        tag: 'button',
        attrs: {
          role: 'switch',
          'aria-label': 'Enable feature',
          'aria-checked': 'false',
        },
      })
    );

    expect(code).toBe('I.click("//*[self::button and @role=\\"switch\\" and @aria-label=\\"Enable feature\\" and @aria-checked=\\"false\\"]")');
  });

  it('falls back to provided locator when classes are not usable', () => {
    const code = buildCanonicalClickCode(
      createComponent({
        tag: 'button',
        locator: '//button[@data-test="save"]',
        classes: ['bad class', '###'],
        attrs: {},
      })
    );

    expect(code).toBe('I.click("//button[@data-test=\\"save\\"]")');
  });

  it('builds icon-aware selector for textless icon buttons', () => {
    const code = buildCanonicalClickCode(
      createComponent({
        tag: 'button',
        text: '',
        classes: ['icon-btn', 'secondary'],
        variant: 'has-icon, icon-only',
        attrs: {},
      })
    );

    expect(code).toBe('I.click("button.icon-btn.secondary:has(svg)")');
  });
});

describe('formatExperienceTitle', () => {
  it('creates imperative how-to title for button clicks', () => {
    const title = formatExperienceTitle({
      componentId: '1',
      component: 'Button "Hide guidelines" [Component Showcase] (secondary-btn, btn-md)',
      action: 'click',
      result: 'success',
      description: 'Clicked "Hide guidelines".',
    });

    expect(title).toBe('click hide guidelines button');
  });

  it('creates imperative how-to title for links', () => {
    const title = formatExperienceTitle({
      componentId: '2',
      component: 'Link "Requirements Shift + 2" [Tests Shift + 1] (has-icon, navigates)',
      action: 'click',
      result: 'success',
      description: 'Clicked the requirements link.',
    });

    expect(title).toBe('click requirements shift + 2 link');
  });

  it('uses action-specific verb mapping for typing', () => {
    const title = formatExperienceTitle({
      componentId: '3',
      component: 'Textbox "Email" [Login form]',
      action: 'type',
      result: 'success',
      description: 'Typed into the email field.',
    });

    expect(title).toBe('type into email textbox');
  });
});

function createComponent(overrides: Partial<any> = {}) {
  return {
    id: 'component-id',
    name: 'Component',
    role: '',
    locator: '//default-locator',
    preferredCode: '',
    eidx: 'e1',
    description: 'component',
    html: '<button></button>',
    text: 'Enable feature',
    tag: 'button',
    classes: ['primary-btn', 'btn-md'],
    attrs: {},
    context: '',
    variant: '',
    placeholder: '',
    disabled: false,
    ariaMatches: [],
    ...overrides,
  };
}
