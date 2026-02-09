import fs from 'node:fs';
import path from 'node:path';
import { type Span, context, trace } from '@opentelemetry/api';
import chalk from 'chalk';
import debug from 'debug';
import dedent from 'dedent';
import { marked } from 'marked';
import { ConfigParser } from '../config.js';
import { Observability } from '../observability.ts';

export type LogType = 'info' | 'success' | 'error' | 'warning' | 'debug' | 'substep' | 'step' | 'multiline' | 'html' | 'input';

export interface TaggedLogEntry {
  type: LogType;
  content: string;
  timestamp?: Date;
  originalArgs?: any[];
  namespace?: string;
}

type LogEntry = TaggedLogEntry;

interface LogDestination {
  isEnabled(): boolean;
  write(entry: TaggedLogEntry): void;
}

class DebugFilter {
  private patterns: { regex: RegExp; exclude: boolean }[] = [];
  private parsed = false;

  private parse(): void {
    if (this.parsed) return;
    this.parsed = true;

    const debugEnv = process.env.DEBUG || '';
    if (!debugEnv) return;

    const parts = debugEnv.split(/[\s,]+/).filter(Boolean);
    for (const part of parts) {
      const exclude = part.startsWith('-');
      const pattern = exclude ? part.slice(1) : part;
      const regex = this.patternToRegex(pattern);
      this.patterns.push({ regex, exclude });
    }
  }

  private patternToRegex(pattern: string): RegExp {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`);
  }

  isEnabled(namespace: string): boolean {
    this.parse();

    if (this.patterns.length === 0) return false;

    let enabled = false;
    for (const { regex, exclude } of this.patterns) {
      if (regex.test(namespace)) {
        enabled = !exclude;
      }
    }
    return enabled;
  }

  hasAnyPatterns(): boolean {
    this.parse();
    return this.patterns.length > 0;
  }
}

const debugFilter = new DebugFilter();

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
    if (entry.type === 'debug') return;
    if (entry.type === 'html') return;
    let content = entry.content;
    if (entry.type === 'multiline') {
      content = chalk.gray(content);
    } else if (entry.type === 'step') {
      content = chalk.gray(`   ${content}`);
    } else if (entry.type === 'substep') {
      content = chalk.gray(`   > ${content}`);
    }
    console.log(content);
  }
}

class DebugDestination implements LogDestination {
  private verboseMode = false;

  isEnabled(): boolean {
    if (process.env.INK_RUNNING) return false;
    return this.verboseMode || debugFilter.hasAnyPatterns();
  }

  isNamespaceEnabled(namespace: string): boolean {
    if (this.verboseMode) return true;
    return debugFilter.isEnabled(namespace);
  }

  setVerboseMode(enabled: boolean): void {
    this.verboseMode = enabled;
  }

  write(namespace: string, ...args: any[]): void {
    if (!this.isNamespaceEnabled(namespace)) return;
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

    try {
      const outputDir = ConfigParser.getInstance().getOutputDir();

      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      this.logFilePath = path.join(outputDir, 'explorbot.log');
      const timestamp = new Date().toISOString();
      fs.appendFileSync(this.logFilePath, `\n\n=== ExplorBot Session Started at ${timestamp} ===\n\n`);
    } catch {
      this.logFilePath = null;
    }
  }
}

class SpanDestination implements LogDestination {
  isEnabled(): boolean {
    return Observability.isTracing();
  }

  write(entry: TaggedLogEntry): void {
    if (entry.type !== 'step') return;
    const activeSpan = stepSpanParent;
    if (!activeSpan) return;
    const tracer = trace.getTracer('ai');
    const step = entry.originalArgs?.[0];
    const stepError = entry.originalArgs?.[1];
    if (!step?.toCode) {
      return;
    }
    const stepName = step?.name ? `I.${step.name}` : 'I.step';
    const stepInput = typeof step?.toCode === 'function' ? step.toCode() : entry.content;
    const errorFromStep = step?.error;
    const errorMessage =
      stepError && typeof stepError === 'object' && 'message' in stepError && typeof stepError.message === 'string'
        ? stepError.message
        : errorFromStep && typeof errorFromStep === 'object' && 'message' in errorFromStep && typeof errorFromStep.message === 'string'
          ? errorFromStep.message
          : stepError && typeof stepError === 'string'
            ? stepError
            : undefined;
    const stepOutput = errorMessage ? `failed: ${errorMessage}` : step?.status || (step?.failed ? 'failed' : step?.success ? 'success' : 'passed');
    const span = tracer.startSpan(stepName, undefined, trace.setSpan(context.active(), activeSpan));
    span.setAttribute('ai.toolCall.name', stepName);
    span.setAttribute('ai.toolCall.args', JSON.stringify({ command: stepInput }));
    span.setAttribute('ai.toolCall.result', JSON.stringify({ status: stepOutput }));
    span.setAttribute('log.timestamp', entry.timestamp?.toISOString() || new Date().toISOString());
    if (step) {
      try {
        const parsedStep = typeof step === 'string' ? JSON.parse(step) : step.simplify();
        span.setAttribute('ai.telemetry.metadata.step', JSON.stringify(parsedStep));
      } catch {
        span.setAttribute('ai.telemetry.metadata.step', '[unserializable step]');
      }
    }
    span.end();
  }
}

class ReactDestination implements LogDestination {
  private logPane: ((entry: LogEntry) => void) | null = null;
  private pendingLogs: TaggedLogEntry[] = [];

  isEnabled(): boolean {
    return this.logPane !== null;
  }

  private shouldWrite(entry: TaggedLogEntry): boolean {
    if (entry.type !== 'debug') return true;
    if (!entry.namespace) return true;
    return debugFilter.isEnabled(entry.namespace);
  }

  write(entry: TaggedLogEntry): void {
    if (!this.shouldWrite(entry)) return;

    if (!this.isEnabled()) {
      if (process.env.INK_RUNNING) {
        this.pendingLogs.push(entry);
      }
      return;
    }
    if (this.pendingLogs.length > 0) {
      for (const pending of this.pendingLogs) {
        if (this.shouldWrite(pending)) {
          this.logPane!(pending);
        }
      }
      this.pendingLogs = [];
    }
    this.logPane!(entry);
  }

  registerLogPane(addLog: (entry: LogEntry) => void): void {
    this.logPane = addLog;
    if (this.pendingLogs.length > 0) {
      for (const pending of this.pendingLogs) {
        if (this.shouldWrite(pending)) {
          this.logPane(pending);
        }
      }
      this.pendingLogs = [];
    }
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
  private span = new SpanDestination();
  public react = new ReactDestination();
  private truncateTags: string[] = ['page_html'];

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

  addTruncateTag(tagName: string): void {
    if (!this.truncateTags.includes(tagName)) {
      this.truncateTags.push(tagName);
    }
  }

  private truncateTagContent(content: string, tagName: string): string {
    const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tagRegex = new RegExp(`<${escapedTag}>([\\s\\S]*?)<\\/${escapedTag}>`, 'g');
    return content.replace(tagRegex, (match, innerContent) => {
      const trimmed = innerContent.trim();
      const totalLength = trimmed.length;
      if (totalLength <= 100) {
        return `<${tagName}>\n    ${trimmed}\n</${tagName}>`;
      }
      const truncated = trimmed.substring(0, 100);
      return `<${tagName}>\n    ${truncated}.... (${totalLength}chars total)\n</${tagName}>`;
    });
  }

  private processArgs(args: any[]): string {
    const processed = args
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

    let result = processed;
    for (const tag of this.truncateTags) {
      result = this.truncateTagContent(result, tag);
    }
    return result;
  }

  log(type: LogType, ...args: any[]): void {
    if (type === 'debug') {
      let namespace = 'explorbot';
      let contentArgs = args;
      if (args.length > 1) {
        namespace = String(args[0]);
        contentArgs = args.slice(1);
      }
      const processedContent = this.processArgs(contentArgs);

      if (!process.env.INK_RUNNING && this.debugDestination.isEnabled()) {
        this.debugDestination.write(namespace, processedContent);
      }

      if (process.env.INK_RUNNING) {
        const entry: TaggedLogEntry = {
          type: 'debug',
          content: `${namespace}: ${processedContent}`,
          timestamp: new Date(),
          namespace,
          originalArgs: contentArgs,
        };
        this.react.write(entry);
      }
      return;
    }

    let content = this.processArgs(args);
    if (type === 'step' && args[0]?.toCode) {
      content = args[0].toCode();
    }
    const entry: TaggedLogEntry = {
      type,
      content,
      timestamp: new Date(),
      originalArgs: args,
    };

    if (this.file.isEnabled()) this.file.write(entry);
    if (this.span.isEnabled()) this.span.write(entry);
    if (process.env.INK_RUNNING) {
      this.react.write(entry);
    } else if (this.console.isEnabled()) {
      this.console.write(entry);
    }
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
let stepSpanParent: Span | null = null;

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
export const addTruncateTag = (tagName: string) => logger.addTruncateTag(tagName);
export const setStepSpanParent = (span: Span | null) => {
  stepSpanParent = span;
};

// Legacy alias for backward compatibility
export const setLogCallback = registerLogPane;

export const pluralize = (count: number, singular: string, plural?: string): string => {
  return count === 1 ? singular : plural || `${singular}s`;
};
