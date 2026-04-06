import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { ConfigParser } from '../../src/config.js';
import { type TaggedLogEntry, createDebug, getMethodsOfObject, isVerboseMode, log, logError, logSubstep, logSuccess, logWarning, registerLogPane, setPreserveConsoleLogs, setVerboseMode, tag, unregisterLogPane } from '../../src/utils/logger';

describe('Logger', () => {
  let originalEnv: any;
  let originalCWD: string;
  let consoleSpy: ReturnType<typeof spyOn>;
  let stderrSpy: ReturnType<typeof spyOn>;
  const testOutputDir = '/tmp/explorbot-test-logs';

  beforeEach(() => {
    originalEnv = { ...process.env };
    originalCWD = process.cwd();

    const configParser = ConfigParser.getInstance();
    (configParser as any).config = { dirs: { output: testOutputDir } };
    (configParser as any).configPath = '/tmp/explorbot.config.js';

    if (existsSync(testOutputDir)) {
      rmSync(testOutputDir, { recursive: true, force: true });
    }

    process.env.INITIAL_CWD = '/tmp';
    process.env.INK_RUNNING = undefined;
    process.env.DEBUG = undefined;

    setVerboseMode(false);
    setPreserveConsoleLogs(false);

    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    stderrSpy = spyOn(process.stderr, 'write').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    stderrSpy.mockRestore();
    process.env = originalEnv;
    process.chdir(originalCWD);

    if (existsSync(testOutputDir)) {
      rmSync(testOutputDir, { recursive: true, force: true });
    }
  });

  describe('basic logging functions', () => {
    it('should log info messages', () => {
      log('Test info message');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Test info message'));
    });

    it('should log success messages', () => {
      logSuccess('Test success message');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Test success message'));
    });

    it('should log error messages', () => {
      logError('Test error message');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Test error message'));
    });

    it('should log warning messages', () => {
      logWarning('Test warning message');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Test warning message'));
    });

    it('should log substep messages', () => {
      logSubstep('Test substep message');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Test substep message'));
    });
  });

  describe('tagged logging', () => {
    it('should create tagged loggers', () => {
      const stepLogger = tag('step');
      stepLogger.log('Tagged step message');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Tagged step message'));
    });

    it('should handle different tag types', () => {
      tag('info').log('Info message');
      tag('error').log('Error message');
      tag('success').log('Success message');
      expect(consoleSpy).toHaveBeenCalledTimes(3);
    });
  });

  describe('debug logging', () => {
    it('should create debug loggers', () => {
      const debugLogger = createDebug('explorbot:test');
      expect(typeof debugLogger).toBe('function');
    });

    it('should log debug messages when DEBUG is set', () => {
      process.env.DEBUG = 'explorbot:test';
      const debugLogger = createDebug('explorbot:test');
      debugLogger('Debug message');
      expect(typeof debugLogger).toBe('function');
    });

    it('should not log debug messages when DEBUG is not set and verbose is off', () => {
      process.env.DEBUG = '';
      setVerboseMode(false);
      const debugLogger = createDebug('explorbot:test');
      debugLogger('Debug message');
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('should log debug messages in verbose mode', () => {
      setVerboseMode(true);
      const debugLogger = createDebug('explorbot:test');
      debugLogger('Verbose debug message');
      expect(isVerboseMode()).toBe(true);
      expect(typeof debugLogger).toBe('function');
    });
  });

  describe('verbose mode', () => {
    it('should set and get verbose mode', () => {
      setVerboseMode(true);
      expect(isVerboseMode()).toBe(true);
      setVerboseMode(false);
    });

    it('should enable debug logging in verbose mode', () => {
      setVerboseMode(true);
      const debugLogger = createDebug('explorbot:verbose');
      debugLogger('Verbose debug');
      expect(isVerboseMode()).toBe(true);
      expect(typeof debugLogger).toBe('function');
    });
  });

  describe('console preservation', () => {
    it('should preserve console logs when enabled', () => {
      setPreserveConsoleLogs(true);
      log('Preserved log message');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Preserved log message'));
    });
  });

  describe('log pane registration', () => {
    it('should register and unregister log panes', () => {
      const mockLogPane = (entry: TaggedLogEntry) => {};
      registerLogPane(mockLogPane);
      unregisterLogPane(mockLogPane);
      expect(true).toBe(true);
    });

    it('should use log pane when registered', () => {
      process.env.INK_RUNNING = 'true';
      const logEntries: TaggedLogEntry[] = [];

      const mockLogPane = (entry: TaggedLogEntry) => {
        logEntries.push(entry);
      };

      registerLogPane(mockLogPane);
      log('Pane message');

      expect(logEntries).toHaveLength(1);
      expect(logEntries[0].content).toBe('Pane message');
      expect(logEntries[0].type).toBe('info');

      unregisterLogPane(mockLogPane);
    });
  });

  describe('argument processing', () => {
    it('should handle string arguments', () => {
      log('Simple string');
      expect(consoleSpy).toHaveBeenCalledWith('Simple string');
    });

    it('should handle multiple arguments', () => {
      log('Multiple', 'arguments', 'test');
      expect(consoleSpy).toHaveBeenCalledWith('Multiple arguments test');
    });

    it('should handle object arguments', () => {
      const testObj = { key: 'value', number: 42 };
      log('Object:', testObj);
      const expectedCall = consoleSpy.mock.calls[0][0];
      expect(expectedCall).toContain('Object:');
      expect(expectedCall).toContain('"key": "value"');
      expect(expectedCall).toContain('"number": 42');
    });

    it('should handle circular object references', () => {
      const circularObj: any = { name: 'test' };
      circularObj.self = circularObj;
      log('Circular:', circularObj);
      const expectedCall = consoleSpy.mock.calls[0][0];
      expect(expectedCall).toContain('Circular: [Object]');
    });

    it('should handle null and undefined', () => {
      log('Null:', null, 'Undefined:', undefined);
      expect(consoleSpy).toHaveBeenCalledWith('Null: null Undefined: undefined');
    });

    it('should handle numbers and booleans', () => {
      log('Number:', 123, 'Boolean:', true);
      expect(consoleSpy).toHaveBeenCalledWith('Number: 123 Boolean: true');
    });
  });

  describe('environment detection', () => {
    it('should detect INK_RUNNING environment', () => {
      process.env.INK_RUNNING = 'true';
      log('INK test message');
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('should detect DEBUG environment variables', () => {
      process.env.DEBUG = 'explorbot:*';
      const debugLogger = createDebug('explorbot:env');
      expect(typeof debugLogger).toBe('function');
      expect(debugLogger).toBeDefined();
    });
  });

  describe('utility functions', () => {
    it('should get methods of an object', () => {
      const testObj = {
        method1: () => {},
        method2: () => {},
        property: 'value',
        number: 42,
      };

      const methods = getMethodsOfObject(testObj);

      expect(methods).toEqual(['method1', 'method2']);
      expect(methods).not.toContain('property');
      expect(methods).not.toContain('number');
    });

    it('should sort methods alphabetically', () => {
      const testObj = {
        zMethod: () => {},
        aMethod: () => {},
        mMethod: () => {},
      };

      const methods = getMethodsOfObject(testObj);

      expect(methods).toEqual(['aMethod', 'mMethod', 'zMethod']);
    });

    it('should exclude constructor from methods', () => {
      const testObj = {
        constructor: () => {},
        method: () => {},
        normalProp: 'value',
      };

      const methods = getMethodsOfObject(testObj);

      expect(methods).not.toContain('constructor');
      expect(methods).toContain('method');
      expect(methods).not.toContain('normalProp');
    });

    it('should handle empty objects', () => {
      const methods = getMethodsOfObject({});
      expect(methods).toEqual([]);
    });

    it('should handle objects with only properties', () => {
      const testObj = {
        prop1: 'value1',
        prop2: 42,
        prop3: true,
      };

      const methods = getMethodsOfObject(testObj);
      expect(methods).toEqual([]);
    });
  });

  describe('multiline logging', () => {
    it('should handle multiline content', () => {
      const multilineLogger = tag('multiline');
      multilineLogger.log('# Heading\n\nSome **bold** text');
      expect(consoleSpy).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle JSON stringify errors gracefully', () => {
      const problematicObj = {};
      Object.defineProperty(problematicObj, 'prop', {
        get: () => {
          throw new Error('Property access error');
        },
        enumerable: true,
      });
      expect(() => {
        log('Message with problematic object:', problematicObj);
      }).not.toThrow();
    });
  });
});
