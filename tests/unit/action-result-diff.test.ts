import { describe, test, expect, beforeEach } from 'bun:test';
import { ActionResult, Diff } from '../../src/action-result.ts';
import { ConfigParser } from '../../src/config.ts';

describe('ActionResult Diff', () => {
  beforeEach(async () => {
    await ConfigParser.getInstance().loadConfig('./explorbot.config.js');
  });
  test('should create diff with previous state', () => {
    const previous = new ActionResult({
      url: '/page1',
      html: '<html><body><h1>Page 1</h1></body></html>',
      ariaSnapshot: 'button "Click me"',
    });

    const current = new ActionResult({
      url: '/page1',
      html: '<html><body><h1>Page 1</h1><button>New Button</button></body></html>',
      ariaSnapshot: 'button "Click me"\nbutton "New Button"',
    });

    const diff = new Diff(current, previous);

    expect(diff.isSameUrl()).toBe(true);
    expect(diff.urlHasChanged()).toBe(false);
  });

  test('should detect URL change', () => {
    const previous = new ActionResult({
      url: '/page1',
      html: '<html><body><h1>Page 1</h1></body></html>',
    });

    const current = new ActionResult({
      url: '/page2',
      html: '<html><body><h1>Page 2</h1></body></html>',
    });

    const diff = new Diff(current, previous);

    expect(diff.isSameUrl()).toBe(false);
    expect(diff.urlHasChanged()).toBe(true);
  });

  test('should handle null previous state', () => {
    const current = new ActionResult({
      url: '/page1',
      html: '<html><body><h1>Page 1</h1></body></html>',
    });

    const diff = new Diff(current, null);

    expect(diff.isSameUrl()).toBe(false);
    expect(diff.urlHasChanged()).toBe(true);
    expect(diff.hasChanges()).toBe(false);
  });

  test('should calculate HTML diff when URLs are same', async () => {
    const previous = new ActionResult({
      url: '/page1',
      html: '<html><body><h1>Page 1</h1></body></html>',
      ariaSnapshot: 'button "Click me"',
    });

    const current = new ActionResult({
      url: '/page1',
      html: '<html><body><h1>Page 1</h1><button>New Button</button></body></html>',
      ariaSnapshot: 'button "Click me"\nbutton "New Button"',
    });

    const diff = new Diff(current, previous);
    await diff.calculate();

    expect(diff.htmlDiff).not.toBeNull();
    expect(diff.htmlSubtree).toBeDefined();
  });

  test('should not calculate HTML diff when URLs differ', async () => {
    const previous = new ActionResult({
      url: '/page1',
      html: '<html><body><h1>Page 1</h1></body></html>',
    });

    const current = new ActionResult({
      url: '/page2',
      html: '<html><body><h1>Page 2</h1></body></html>',
    });

    const diff = new Diff(current, previous);
    await diff.calculate();

    expect(diff.htmlDiff).toBeNull();
    expect(diff.htmlSubtree).toBe('');
  });

  test('should calculate aria diff', async () => {
    const previous = new ActionResult({
      url: '/page1',
      html: '<html><body><h1>Page 1</h1></body></html>',
      ariaSnapshot: '- button "Click me"',
    });

    const current = new ActionResult({
      url: '/page1',
      html: '<html><body><h1>Page 1</h1></body></html>',
      ariaSnapshot: '- button "Click me"\n- button "New Button"',
    });

    const diff = new Diff(current, previous);
    await diff.calculate();

    expect(diff.ariaDiff).not.toBeNull();
    expect(diff.ariaChanged).not.toBeNull();
  });

  test('should detect changes correctly', async () => {
    const previous = new ActionResult({
      url: '/page1',
      html: '<html><body><h1>Page 1</h1></body></html>',
      ariaSnapshot: 'button "Click me"',
    });

    const current = new ActionResult({
      url: '/page1',
      html: '<html><body><h1>Page 1</h1><button>New Button</button></body></html>',
      ariaSnapshot: 'button "Click me"\nbutton "New Button"',
    });

    const diff = new Diff(current, previous);
    await diff.calculate();

    expect(diff.hasChanges()).toBe(true);
  });

  test('should not detect changes for identical states', async () => {
    const previous = new ActionResult({
      url: '/page1',
      html: '<html><body><h1>Page 1</h1></body></html>',
      ariaSnapshot: 'button "Click me"',
    });

    const current = new ActionResult({
      url: '/page1',
      html: '<html><body><h1>Page 1</h1></body></html>',
      ariaSnapshot: 'button "Click me"',
    });

    const diff = new Diff(current, previous);
    await diff.calculate();

    expect(diff.hasChanges()).toBe(false);
  });
});
