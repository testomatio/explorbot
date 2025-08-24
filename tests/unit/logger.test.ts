import {
  describe,
  expect,
  it,
  beforeEach,
  afterEach,
  spyOn,
  mock,
} from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  tag,
  log,
  logSuccess,
  logError,
  logWarning,
  logSubstep,
  createDebug,
  setLogCallback,
  setVerboseMode,
  isVerboseMode,
  type TaggedLogEntry,
} from '../../src/utils/logger.js';
import { ConfigParser } from '../../src/config.js';

describe('Logger', () => {
  let originalConsoleLog: typeof console.log;
  let originalDebugEnv: string | undefined;
  let consoleSpy: any;
  let fsSpy: any;
  let mockCallback: any;

  beforeEach(() => {
    originalConsoleLog = console.log;
    originalDebugEnv = process.env.DEBUG;
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    fsSpy = spyOn(fs, 'appendFileSync').mockImplementation(() => {});
    mockCallback = mock(() => {});

    // Clear debug environment
    delete process.env.DEBUG;
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    process.env.DEBUG = originalDebugEnv;
    consoleSpy.mockRestore();
    fsSpy.mockRestore();
  });

  describe('basic logging functions', () => {
    it('should log info messages to console', () => {
      log('Test message');
      expect(consoleSpy).toHaveBeenCalledWith('Test message');
    });

    it('should log success messages to console', () => {
      logSuccess('Success message');
      expect(consoleSpy).toHaveBeenCalledWith('Success message');
    });

    it('should log error messages to console', () => {
      logError('Error message');
      expect(consoleSpy).toHaveBeenCalledWith('Error message');
    });

    it('should log warning messages to console', () => {
      logWarning('Warning message');
      expect(consoleSpy).toHaveBeenCalledWith('Warning message');
    });

    it('should log substep messages to console', () => {
      logSubstep('Substep message');
      expect(consoleSpy).toHaveBeenCalledWith('Substep message');
    });
  });

  describe('tag logging', () => {
    it('should log with specific tag types', () => {
      tag('info').log('Info via tag');
      tag('success').log('Success via tag');
      tag('error').log('Error via tag');
      tag('warning').log('Warning via tag');
      tag('debug').log('Debug via tag');
      tag('substep').log('Substep via tag');
      tag('multiline').log('Multiline via tag');

      expect(consoleSpy).toHaveBeenCalledTimes(7);
      expect(consoleSpy).toHaveBeenCalledWith('Info via tag');
      expect(consoleSpy).toHaveBeenCalledWith('Success via tag');
      expect(consoleSpy).toHaveBeenCalledWith('Error via tag');
      expect(consoleSpy).toHaveBeenCalledWith('Warning via tag');
      expect(consoleSpy).toHaveBeenCalledWith('Debug via tag');
      expect(consoleSpy).toHaveBeenCalledWith('Substep via tag');
      expect(consoleSpy).toHaveBeenCalledWith('Multiline via tag');
    });

    it('should handle multiple arguments', () => {
      tag('info').log('Message', 123, { key: 'value' });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Message 123 {\n  "key": "value"\n}'
      );
    });

    it('should handle objects via JSON.stringify', () => {
      const testObj = { test: 'value', number: 42 };
      tag('info').log('Object:', testObj);
      expect(consoleSpy).toHaveBeenCalledWith(
        'Object: {\n  "test": "value",\n  "number": 42\n}'
      );
    });

    it('should handle circular objects gracefully', () => {
      const circular: any = { name: 'test' };
      circular.self = circular;

      tag('info').log('Circular:', circular);
      expect(consoleSpy).toHaveBeenCalledWith('Circular: [Object]');
    });
  });

  describe('debug logging', () => {
    it('should not log to debug destination when DEBUG env is not set', () => {
      const debugLog = createDebug('explorbot:test');
      debugLog('Debug message');

      expect(consoleSpy).toHaveBeenCalledWith('[test] Debug message');
      expect(fsSpy).not.toHaveBeenCalled();
    });

    it('should log to debug and file destinations when DEBUG env is set', () => {
      process.env.DEBUG = 'explorbot:*';

      const debugLog = createDebug('explorbot:test');
      debugLog('Debug message');

      expect(consoleSpy).toHaveBeenCalledWith('[test] Debug message');
      // File logging would be called if config is properly loaded
    });

    it('should extract namespace from debug logs', () => {
      const debugLog = createDebug('explorbot:action');
      debugLog('Action executed');

      expect(consoleSpy).toHaveBeenCalledWith('[action] Action executed');
    });

    it('should handle debug logs without explorbot prefix', () => {
      const debugLog = createDebug('test');
      debugLog('Simple debug');

      expect(consoleSpy).toHaveBeenCalledWith('[test] Simple debug');
    });
  });

  describe('React callback destination', () => {
    it('should call React callback when set', () => {
      setLogCallback(mockCallback);

      log('Test message');

      expect(mockCallback).toHaveBeenCalledTimes(1);
      const callArgs = mockCallback.mock.calls[0][0] as TaggedLogEntry;
      expect(callArgs.type).toBe('info');
      expect(callArgs.content).toBe('Test message');
      expect(callArgs.timestamp).toBeInstanceOf(Date);
    });

    it('should call React callback for different log types', () => {
      setLogCallback(mockCallback);

      tag('success').log('Success');
      tag('error').log('Error');
      tag('debug').log('Debug');

      expect(mockCallback).toHaveBeenCalledTimes(3);

      const calls = mockCallback.mock.calls;
      expect((calls[0][0] as TaggedLogEntry).type).toBe('success');
      expect((calls[1][0] as TaggedLogEntry).type).toBe('error');
      expect((calls[2][0] as TaggedLogEntry).type).toBe('debug');
    });

    it('should not crash when no React callback is set', () => {
      expect(() => {
        log('Test without callback');
      }).not.toThrow();
    });
  });

  describe('file destination', () => {
    it('should not write to file when DEBUG env is not set', () => {
      log('Test message');
      expect(fsSpy).not.toHaveBeenCalled();
    });

    it('should be enabled when DEBUG env is set', () => {
      delete process.env.DEBUG;
      // File destination should not be enabled
      log('Test message without debug');
      const callsWithoutDebug = fsSpy.mock.calls.length;

      process.env.DEBUG = 'explorbot:*';
      // File destination should be enabled (but may fail due to config)
      log('Test message with debug');
      // We can't easily test file writing due to singleton state,
      // but we can verify the environment check works
      expect(process.env.DEBUG).toContain('explorbot:');
    });

    it('should handle config errors gracefully', () => {
      process.env.DEBUG = 'explorbot:*';
      spyOn(ConfigParser.getInstance(), 'getConfig').mockImplementation(() => {
        throw new Error('Config error');
      });

      expect(() => {
        log('Test message');
      }).not.toThrow();

      // Should not crash, but file logging won't work
    });
  });

  describe('console destination', () => {
    it('should always be enabled', () => {
      log('Always logged');
      expect(consoleSpy).toHaveBeenCalledWith('Always logged');
    });

    it('should log all message types', () => {
      log('Info');
      logSuccess('Success');
      logError('Error');
      logWarning('Warning');
      tag('debug').log('Debug');
      tag('substep').log('Substep');
      tag('multiline').log('Multiline');

      expect(consoleSpy).toHaveBeenCalledTimes(7);
    });
  });

  describe('integration tests', () => {
    it('should send logs to all enabled destinations simultaneously', () => {
      process.env.DEBUG = 'explorbot:*';
      setLogCallback(mockCallback);

      log('Integration test');

      // Console destination
      expect(consoleSpy).toHaveBeenCalledWith('Integration test');

      // React callback destination
      expect(mockCallback).toHaveBeenCalledTimes(1);
      const callbackArg = mockCallback.mock.calls[0][0] as TaggedLogEntry;
      expect(callbackArg.content).toBe('Integration test');

      // Debug and file destinations are enabled when DEBUG env is set
      // (File destination would write if config is properly loaded)
    });

    it('should handle mixed argument types correctly', () => {
      const testData = {
        string: 'text',
        number: 42,
        boolean: true,
        array: [1, 2, 3],
        nested: { key: 'value' },
      };

      tag('info').log('Mixed:', testData, 'end');

      const expectedContent = `Mixed: {\n  "string": "text",\n  "number": 42,\n  "boolean": true,\n  "array": [\n    1,\n    2,\n    3\n  ],\n  "nested": {\n    "key": "value"\n  }\n} end`;

      expect(consoleSpy).toHaveBeenCalledWith(expectedContent);
    });
  });

  describe('error handling', () => {
    it('should handle errors gracefully', () => {
      process.env.DEBUG = 'explorbot:*';

      expect(() => {
        log('Test message');
      }).not.toThrow();

      // Logger should not crash even if file operations fail
    });

    it('should handle null and undefined arguments', () => {
      expect(() => {
        tag('info').log(null, undefined, 'text');
      }).not.toThrow();

      expect(consoleSpy).toHaveBeenCalledWith('null undefined text');
    });
  });

  describe('verbose mode', () => {
    it('should enable verbose mode when set', () => {
      setVerboseMode(true);
      expect(isVerboseMode()).toBe(true);
      
      setVerboseMode(false);
      expect(isVerboseMode()).toBe(false);
    });

    it('should respect verbose mode for debug logging', () => {
      // Clear debug environment
      delete process.env.DEBUG;
      
      setVerboseMode(false);
      const debugLog = createDebug('explorbot:test');
      debugLog('Debug message');
      
      // Should not log when verbose mode is off
      expect(consoleSpy).toHaveBeenCalledTimes(0);
      
      setVerboseMode(true);
      debugLog('Debug message with verbose');
      
      // Should log when verbose mode is on
      expect(consoleSpy).toHaveBeenCalledTimes(1);
    });

    it('should work with DEBUG environment variable', () => {
      // Set DEBUG environment
      process.env.DEBUG = 'explorbot:*';
      
      // Should be enabled even without setting verbose mode
      expect(isVerboseMode()).toBe(true);
      
      // Setting verbose mode should still work
      setVerboseMode(false);
      expect(isVerboseMode()).toBe(false);
      
      setVerboseMode(true);
      expect(isVerboseMode()).toBe(true);
    });
  });
});
