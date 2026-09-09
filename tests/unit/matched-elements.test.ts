import { describe, expect, it } from 'bun:test';
import { formatMatchedElements } from '../../src/ai/tools.ts';

function multipleElementsError(elements: Array<{ xpath: string; html: string; text: string; visible?: boolean }>): Error {
  const error = new Error('Multiple elements found');
  error.name = 'MultipleElementsFound';
  (error as any).webElements = elements.map((el) => {
    const webElement: Record<string, any> = {
      toAbsoluteXPath: async () => el.xpath,
      toOuterHTML: async () => el.html,
      getText: async () => el.text,
    };
    if (el.visible !== undefined) webElement.isVisible = async () => el.visible;
    return webElement;
  });
  return error;
}

const TAILWIND_BUTTON = '<button type="button"><span class="content inline-flex items-center gap-3 w-full"><span class="badge badge-type manual"><svg class="md-icon md-icon-file-document-outline bg-amber-100"></svg></span><span>New test</span></span></button>';

describe('formatMatchedElements', () => {
  it('reports visible text when simplified html has none', async () => {
    const error = multipleElementsError([
      { xpath: '//html/body/ul/li[3]/button', html: TAILWIND_BUTTON, text: 'New test' },
      { xpath: '//html/body/ul/li[4]/div/button', html: TAILWIND_BUTTON, text: 'New tests from requirement' },
    ]);

    const formatted = await formatMatchedElements(error);

    expect(formatted).toContain('Element 1:\nText: "New test"');
    expect(formatted).toContain('Element 2:\nText: "New tests from requirement"');
  });

  it('collapses whitespace of text spread across nested nodes', async () => {
    const error = multipleElementsError([{ xpath: '//html/body/button', html: TAILWIND_BUTTON, text: '\n  New\n  test  \n' }]);

    const formatted = await formatMatchedElements(error);

    expect(formatted).toContain('Text: "New test"');
  });

  it('caps long text', async () => {
    const error = multipleElementsError([{ xpath: '//html/body/button', html: TAILWIND_BUTTON, text: 'a'.repeat(500) }]);

    const formatted = await formatMatchedElements(error);
    const text = formatted!.split('\n')[1];

    expect(text.length).toBeLessThan(100);
    expect(text).toEndWith('..."');
  });

  it('drops utility classes and generated attributes from the html', async () => {
    const error = multipleElementsError([{ xpath: '//html/body/button', html: TAILWIND_BUTTON, text: 'New test' }]);

    const formatted = await formatMatchedElements(error);

    expect(formatted).toContain('<span>New test</span>');
    expect(formatted).toContain('class="badge badge-type manual"');
    expect(formatted).not.toContain('inline-flex');
    expect(formatted).not.toContain('items-center');
    expect(formatted).not.toContain('w-full');
    expect(formatted).not.toContain('bg-amber-100');
  });

  it('says which matches are on screen', async () => {
    const error = multipleElementsError([
      { xpath: '//html/body/div[1]/form/input', html: TAILWIND_BUTTON, text: 'Sign In', visible: false },
      { xpath: '//html/body/div[2]/form/input', html: TAILWIND_BUTTON, text: 'Sign In', visible: true },
    ]);

    const formatted = await formatMatchedElements(error);

    expect(formatted).toContain('Element 1:\nText: "Sign In"\nVisible: false');
    expect(formatted).toContain('Element 2:\nText: "Sign In"\nVisible: true');
  });

  it('leaves visibility out when the elements cannot report it', async () => {
    const error = multipleElementsError([{ xpath: '//html/body/button', html: TAILWIND_BUTTON, text: 'New test' }]);

    const formatted = await formatMatchedElements(error);

    expect(formatted).not.toContain('Visible:');
  });

  it('marks a match that wraps another match', async () => {
    const error = multipleElementsError([
      { xpath: '//html/body/div/ul/li/div', html: '<div role="button"><li role="button">Root</li></div>', text: 'Root' },
      { xpath: '//html/body/div/ul/li/div/li', html: '<li role="button">Root</li>', text: 'Root' },
      { xpath: '//html/body/div/ul/li[165]/div', html: '<div role="button">Test Suite Root</div>', text: 'Test Suite Root' },
    ]);

    const formatted = await formatMatchedElements(error);

    expect(formatted).toContain('Element 1:\nText: "Root"\nWraps: element 2');
    expect(formatted).not.toContain('Element 2:\nText: "Root"\nWraps:');
    expect(formatted).not.toContain('Element 3:\nText: "Test Suite Root"\nWraps:');
  });

  it('falls back when the error carries no elements', async () => {
    const formatted = await formatMatchedElements(new Error('boom'));

    expect(formatted).toContain('Could not fetch element details');
  });
});
