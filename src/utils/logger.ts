import debug from 'debug';
import fs from 'node:fs';
import path from 'node:path';
import { ConfigParser } from '../config.js';

export type LogType =
  | 'info'
  | 'success'
  | 'error'
  | 'warning'
  | 'debug'
  | 'substep'
  | 'step'
  | 'multiline';

export interface TaggedLogEntry {
  type: LogType;
  content: string;
  timestamp?: Date;
}

type LogEntry = string | TaggedLogEntry;

interface LogDestination {
  isEnabled(): boolean;
  write(entry: TaggedLogEntry): void;
}

class ConsoleDestination implements LogDestination {
  private verboseMode = false;

  isEnabled(): boolean {
    return !process.env.INK_RUNNING;
  }

  setVerboseMode(enabled: boolean): void {
    this.verboseMode = enabled;
  }

  write(entry: TaggedLogEntry): void {
    if (entry.type === 'debug' && !this.verboseMode) return;
    console.log(entry.content);
  }
}

class DebugDestination implements LogDestination {
  private verboseMode = false;

  isEnabled(): boolean {
    return (
      this.verboseMode || Boolean(process.env.DEBUG?.includes('explorbot:'))
    );
  }

  setVerboseMode(enabled: boolean): void {
    this.verboseMode = enabled;
  }

  write(entry: TaggedLogEntry): void {
    if (!this.isEnabled()) return;

    if (entry.type === 'debug') {
      const namespace =
        entry.content.toString().match(/\[([^\]]+)\]/)?.[1] || 'app';
      console.log(`[DEBUG:${namespace}] ${entry.content}`);
    }
  }
}

class FileDestination implements LogDestination {
  private initialized = false;
  private logFilePath: string | null = null;
  private verboseMode = false;

  isEnabled(): boolean {
    return (
      this.verboseMode || Boolean(process.env.DEBUG?.includes('explorbot:'))
    );
  }

  setVerboseMode(enabled: boolean): void {
    this.verboseMode = enabled;
  }

  write(entry: TaggedLogEntry): void {
    this.ensureInitialized();
    if (this.logFilePath) {
      try {
        const timestamp =
          entry.timestamp?.toISOString() || new Date().toISOString();
        fs.appendFileSync(
          this.logFilePath,
          `[${timestamp}] [${entry.type.toUpperCase()}] ${entry.content}\n`
        );
      } catch (error) {
        console.warn('Failed to write to log file:', error);
      }
    }
  }

  private ensureInitialized(): void {
    if (this.initialized) return;

    this.initialized = true;

    let outputDir = 'output';
    let baseDir = process.env.INITIAL_CWD || process.cwd();
    try {
      const parser = ConfigParser.getInstance();
      const config = parser.getConfig();
      const configPath = parser.getConfigPath();
      if (configPath) baseDir = path.dirname(configPath);
      outputDir = path.join(baseDir, config?.dirs?.output || outputDir);
    } catch {
      outputDir = path.join(baseDir, outputDir);
    }

    try {
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      this.logFilePath = path.join(outputDir, 'explorbot.log');
      const timestamp = new Date().toISOString();
      fs.appendFileSync(
        this.logFilePath,
        `\n=== ExplorBot Session Started at ${timestamp} ===\n`
      );
    } catch {
      this.logFilePath = null;
    }
  }
}

class ReactDestination implements LogDestination {
  private callback: ((entry: LogEntry) => void) | null = null;

  isEnabled(): boolean {
    return Boolean(this.callback);
  }

  write(entry: TaggedLogEntry): void {
    if (this.callback) {
      this.callback(entry);
    }
  }

  setCallback(callback: (entry: LogEntry) => void): void {
    this.callback = callback;
  }
}

class Logger {
  private static instance: Logger;
  private console = new ConsoleDestination();
  private debugDestination = new DebugDestination();
  private file = new FileDestination();
  public react = new ReactDestination();

  private constructor() {}

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  setVerboseMode(enabled: boolean): void {
    this.debugDestination.setVerboseMode(enabled);
    this.file.setVerboseMode(enabled);
    this.console.setVerboseMode(enabled);
  }

  isVerboseMode(): boolean {
    return this.debugDestination.isEnabled();
  }

  private processArgs(args: any[]): string {
    return args
      .map((arg) => {
        if (typeof arg === 'object' && arg !== null) {
          try {
            return JSON.stringify(arg, null, 2);
          } catch {
            return '[Object]';
          }
        }
        return String(arg);
      })
      .join(' ');
  }

  log(type: LogType, ...args: any[]): void {
    const content = this.processArgs(args);
    const entry: TaggedLogEntry = {
      type,
      content,
      timestamp: new Date(),
    };

    if (this.console.isEnabled()) this.console.write(entry);
    if (this.debugDestination.isEnabled()) this.debugDestination.write(entry);
    if (this.file.isEnabled()) this.file.write(entry);
    if (this.react.isEnabled()) this.react.write(entry);
  }

  info(...args: any[]): void {
    this.log('info', ...args);
  }

  success(...args: any[]): void {
    this.log('success', ...args);
  }

  error(...args: any[]): void {
    this.log('error', ...args);
  }

  warning(...args: any[]): void {
    this.log('warning', ...args);
  }

  debug(namespace: string, ...args: any[]): void {
    const content = this.processArgs(args);
    this.log('debug', `[${namespace.replace('explorbot:', '')}] ${content}`);
  }

  substep(...args: any[]): void {
    this.log('substep', ...args);
  }

  multiline(...args: any[]): void {
    this.log('multiline', ...args);
  }
}

const logger = Logger.getInstance();

export const setLogCallback = (callback: (entry: LogEntry) => void) => {
  logger.react.setCallback(callback);
};

export const tag = (type: LogType) => ({
  log: (...args: any[]) => logger.log(type, ...args),
});

export const log = (...args: any[]) => logger.info(...args);
export const logSuccess = (...args: any[]) => logger.success(...args);
export const logError = (...args: any[]) => logger.error(...args);
export const logWarning = (...args: any[]) => logger.warning(...args);
export const logSubstep = (...args: any[]) => logger.substep(...args);

export const createDebug = (namespace: string) => {
  return (...args: any[]) => logger.debug(namespace, ...args);
};

export const getMethodsOfObject = (obj: any): string[] => {
  const methods: string[] = [];

  for (const key in obj) {
    if (typeof obj[key] === 'function' && key !== 'constructor') {
      methods.push(key);
    }
  }

  return methods.sort();
};

export const setVerboseMode = (enabled: boolean) =>
  logger.setVerboseMode(enabled);
export const isVerboseMode = () => logger.isVerboseMode();
