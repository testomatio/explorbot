import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { createCodeceptJSTools } from '../../src/ai/tools.js';
import { ConfigParser } from '../../src/config.js';

describe('CodeceptJS Tools', () => {
  let mockActor: any;
  let tools: any;

  beforeEach(() => {
    // Set up test config for ActionResult creation
    ConfigParser.resetForTesting();
    ConfigParser.setupTestConfig();

    mockActor = {
      click: mock(() => Promise.resolve()),
      fillField: mock(() => Promise.resolve()),
      type: mock(() => Promise.resolve()),
      grabCurrentUrl: mock(() =>
        Promise.resolve('https://example.com/current')
      ),
      grabTitle: mock(() => Promise.resolve('Current Page')),
      grabHTMLFrom: mock(() =>
        Promise.resolve('<html><body>Current</body></html>')
      ),
      saveScreenshot: mock(() => Promise.resolve(Buffer.from('screenshot'))),
    };

    tools = createCodeceptJSTools(mockActor);

    // Clear all mocks
    Object.values(mockActor).forEach((mockFn: any) => {
      if (mockFn.mockClear) mockFn.mockClear();
    });
  });

  afterEach(() => {
    ConfigParser.resetForTesting();
  });

  describe('click tool', () => {
    it('should be defined with correct description and parameters', () => {
      expect(tools.click).toBeDefined();
      expect(tools.click.description).toContain('Click on an element');
      expect(tools.click.parameters).toBeDefined();
    });

    it('should call actor.click with locator only', async () => {
      const result = await tools.click.execute({ locator: '.button' });

      expect(mockActor.click).toHaveBeenCalledWith('.button');
      expect(result.success).toBe(true);
      expect(result.action).toBe('click');
      expect(result.locator).toBe('.button');
    });

    it('should call actor.click with locator and context', async () => {
      const result = await tools.click.execute({
        locator: '.button',
        context: '.form',
      });

      expect(mockActor.click).toHaveBeenCalledWith('.button', '.form');
      expect(result.success).toBe(true);
      expect(result.context).toBe('.form');
    });

    it('should capture page state after successful click', async () => {
      const result = await tools.click.execute({ locator: '.button' });

      expect(mockActor.grabCurrentUrl).toHaveBeenCalled();
      expect(mockActor.grabTitle).toHaveBeenCalled();
      expect(mockActor.grabHTMLFrom).toHaveBeenCalledWith('body');
      expect(result.pageState).toEqual({
        url: 'https://example.com/current',
        title: 'Current Page',
        html: '',
      });
    });

    it('should handle click errors gracefully', async () => {
      const clickError = new Error('Element not found');
      mockActor.click.mockRejectedValueOnce(clickError);

      const result = await tools.click.execute({ locator: '.missing' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Error: Element not found');
      expect(result.action).toBe('click');
      expect(result.locator).toBe('.missing');
    });

    it('should not capture page state on click failure', async () => {
      mockActor.click.mockRejectedValueOnce(new Error('Click failed'));

      const result = await tools.click.execute({ locator: '.missing' });

      expect(mockActor.grabCurrentUrl).not.toHaveBeenCalled();
      expect(result.pageState).toBeUndefined();
    });
  });

  describe('type tool', () => {
    it('should be defined with correct description and parameters', () => {
      expect(tools.type).toBeDefined();
      expect(tools.type.description).toContain('Send keyboard input');
      expect(tools.type.parameters).toBeDefined();
    });

    it('should call actor.type when no locator provided', async () => {
      const result = await tools.type.execute({ text: 'Hello World' });

      expect(mockActor.type).toHaveBeenCalledWith('Hello World');
      expect(mockActor.fillField).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.action).toBe('type');
      expect(result.text).toBe('Hello World');
      expect(result.locator).toBeUndefined();
    });

    it('should call actor.fillField when locator provided', async () => {
      const result = await tools.type.execute({
        text: 'Hello World',
        locator: '#username',
      });

      expect(mockActor.fillField).toHaveBeenCalledWith(
        '#username',
        'Hello World'
      );
      expect(mockActor.type).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.locator).toBe('#username');
    });

    it('should capture page state after successful type', async () => {
      const result = await tools.type.execute({
        text: 'test',
        locator: '#input',
      });

      expect(mockActor.grabCurrentUrl).toHaveBeenCalled();
      expect(mockActor.grabTitle).toHaveBeenCalled();
      expect(mockActor.grabHTMLFrom).toHaveBeenCalledWith('body');
      expect(result.pageState).toEqual({
        url: 'https://example.com/current',
        title: 'Current Page',
        html: '',
      });
    });

    it('should handle type errors gracefully', async () => {
      const typeError = new Error('Input field not found');
      mockActor.fillField.mockRejectedValueOnce(typeError);

      const result = await tools.type.execute({
        text: 'test',
        locator: '#missing',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Error: Input field not found');
      expect(result.action).toBe('type');
      expect(result.text).toBe('test');
      expect(result.locator).toBe('#missing');
    });

    it('should not capture page state on type failure', async () => {
      mockActor.type.mockRejectedValueOnce(new Error('Type failed'));

      const result = await tools.type.execute({ text: 'test' });

      expect(mockActor.grabCurrentUrl).not.toHaveBeenCalled();
      expect(result.pageState).toBeUndefined();
    });
  });

  describe('page state capture', () => {
    it('should handle screenshot capture failures gracefully', async () => {
      mockActor.saveScreenshot.mockRejectedValueOnce(
        new Error('Screenshot failed')
      );

      const result = await tools.click.execute({ locator: '.button' });

      expect(result.success).toBe(true);
      expect(result.pageState).toEqual({
        url: 'https://example.com/current',
        title: 'Current Page',
        html: '',
      });
    });

    it('should handle page state capture failures', async () => {
      mockActor.grabCurrentUrl.mockRejectedValueOnce(
        new Error('URL grab failed')
      );

      // Should return success=false when page state capture fails after successful click
      const result = await tools.click.execute({ locator: '.button' });

      expect(mockActor.click).toHaveBeenCalledWith('.button');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to capture page state');
    });
  });

  describe('tool integration', () => {
    it('should return tools object with both click and type tools', () => {
      expect(Object.keys(tools)).toEqual(['click', 'type']);
    });

    it('should work with different actors', () => {
      const differentActor = {
        click: mock(() => Promise.resolve()),
        fillField: mock(() => Promise.resolve()),
        type: mock(() => Promise.resolve()),
        grabCurrentUrl: mock(() => Promise.resolve('https://different.com')),
        grabTitle: mock(() => Promise.resolve('Different Page')),
        grabHTMLFrom: mock(() =>
          Promise.resolve('<html><body>Different</body></html>')
        ),
        saveScreenshot: mock(() => Promise.resolve()),
      };

      const differentTools = createCodeceptJSTools(differentActor);
      expect(differentTools).toBeDefined();
      expect(Object.keys(differentTools)).toEqual(['click', 'type']);
    });
  });
});
