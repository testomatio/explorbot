import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import debug from 'debug';
import dedent from 'dedent';
import { marked } from 'marked';
import { ConfigParser } from '../config.js';

export type LogType = 'info' | 'success' | 'error' | 'warning' | 'debug' | 'substep' | 'step' | 'multiline' | 'html';

export interface TaggedLogEntry {
  type: LogType;
  content: string;
  timestamp?: Date;
  originalArgs?: any[];
}

type LogEntry = TaggedLogEntry;

interface LogDestination {
  isEnabled(): boolean;
  write(entry: TaggedLogEntry): void;
}

class ConsoleDestination implements LogDestination {
  private verboseMode = false;
  private forceEnabled = false;

  isEnabled(): boolean {
    return this.forceEnabled || !process.env.INK_RUNNING;
  }

  forceEnable(enabled: boolean): void {
    this.forceEnabled = enabled;
  }

  setVerboseMode(enabled: boolean): void {
    this.verboseMode = enabled;
  }

  write(entry: TaggedLogEntry): void {
    if (entry.type === 'debug') return; // we use debug for that
    if (entry.type === 'html') return;
    let content = entry.content;
    if (entry.type === 'multiline') {
      content = chalk.gray(content);
    }
    console.log(content);
  }
}

class DebugDestination implements LogDestination {
  private verboseMode = false;

  isEnabled(): boolean {
    if (process.env.INK_RUNNING) return false;
    return this.verboseMode || Boolean(process.env.DEBUG?.includes('explorbot:'));
  }

  setVerboseMode(enabled: boolean): void {
    this.verboseMode = enabled;
  }

  write(...args: any[]): void {
    if (!this.isEnabled()) return;

    let namespace = 'explorbot';
    if (args.length > 1) {
      namespace = args[0];
      args = args.slice(1);
    }
    debug(namespace).apply(null, args);
  }
}

class FileDestination implements LogDestination {
  private initialized = false;
  private logFilePath: string | null = null;
  private verboseMode = true;

  isEnabled(): boolean {
    return true;
  }

  setVerboseMode(enabled: boolean): void {
    this.verboseMode = enabled;
  }

  write(entry: TaggedLogEntry): void {
    if (entry.type === 'html') return;
    if (entry.type === 'multiline') return;

    this.ensureInitialized();
    if (this.logFilePath) {
      try {
        const timestamp = entry.timestamp?.toISOString() || new Date().toISOString();
        fs.appendFileSync(this.logFilePath, `[${timestamp}] [${entry.type.toUpperCase()}] ${entry.content}\n`);
      } catch (error) {
        console.warn('Failed to write to log file:', error);
      }
    }
  }

  private ensureInitialized(): void {
    if (this.initialized) return;

    this.initialized = true;

    const outputDir = ConfigParser.getInstance().getOutputDir();

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    this.logFilePath = path.join(outputDir, 'explorbot.log');
    const timestamp = new Date().toISOString();
    fs.appendFileSync(this.logFilePath, `\n\n=== ExplorBot Session Started at ${timestamp} ===\n\n`);
  }
}

class ReactDestination implements LogDestination {
  private logPane: ((entry: LogEntry) => void) | null = null;

  isEnabled(): boolean {
    return this.logPane !== null;
  }

  write(entry: TaggedLogEntry): void {
    if (!this.isEnabled()) {
      console.log(entry.content);
      return;
    }
    this.logPane!(entry);
  }

  registerLogPane(addLog: (entry: LogEntry) => void): void {
    this.logPane = addLog;
  }

  unregisterLogPane(addLog: (entry: LogEntry) => void): void {
    if (this.logPane !== addLog) return;
    this.logPane = null;
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
    this.console.setVerboseMode(enabled);
  }

  setPreserveConsoleLogs(enabled: boolean): void {
    this.console.forceEnable(enabled);
  }

  isVerboseMode(): boolean {
    return this.debugDestination.isEnabled();
  }

  registerLogPane(addLog: (entry: LogEntry) => void): void {
    this.react.registerLogPane(addLog);
  }

  unregisterLogPane(addLog: (entry: LogEntry) => void): void {
    this.react.unregisterLogPane(addLog);
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
    if (type === 'debug') {
      this.debugDestination.write(...args);
      return;
    }
    const content = this.processArgs(args);
    const entry: TaggedLogEntry = {
      type,
      content,
      timestamp: new Date(),
    };

    // Write to all enabled destinations in order
    // Note: When console is force enabled, we still want logs in the log pane
    if (!this.react.isEnabled() && this.console.isEnabled()) this.console.write(entry);
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
    this.log('debug', namespace, ...args);
  }

  substep(...args: any[]): void {
    this.log('substep', ...args);
  }

  multiline(...args: any[]): void {
    this.log('multiline', ...args);
  }
}

const logger = Logger.getInstance();

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

export const setVerboseMode = (enabled: boolean) => logger.setVerboseMode(enabled);
export const setPreserveConsoleLogs = (enabled: boolean) => logger.setPreserveConsoleLogs(enabled);
export const isVerboseMode = () => logger.isVerboseMode();

export const registerLogPane = (addLog: (entry: LogEntry) => void) => logger.registerLogPane(addLog);
export const unregisterLogPane = (addLog: (entry: LogEntry) => void) => logger.unregisterLogPane(addLog);

// Legacy alias for backward compatibility
export const setLogCallback = registerLogPane;
