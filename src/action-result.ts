import fs from 'node:fs';
import { join } from 'node:path';
import micromatch from 'micromatch';
import { minifyHtml, removeNonInteractiveElements } from 'codeceptjs/lib/html';
import type { WebPageState } from './state-manager.ts';
import { createDebug } from './utils/logger.ts';

const debugLog = createDebug('explorbot:action-state');

interface ActionResultData {
  html: string;
  url: string;
  screenshot?: Buffer;
  title?: string;
  timestamp?: Date;
  error?: string | null;
  h1?: string;
  h2?: string;
  h3?: string;
  h4?: string;
  browserLogs?: any[];
}

export class ActionResult {
  public html: string;
  public readonly screenshot: Buffer | null | undefined;
  public readonly title: string;
  public readonly error: string | null;
  public readonly timestamp: Date;
  public readonly h1: string | null;
  public readonly h2: string | null;
  public readonly h3: string | null;
  public readonly h4: string | null;
  public readonly url: string | null;
  public readonly browserLogs: any[];

  constructor(data: ActionResultData) {
    const defaults = {
      timestamp: new Date(),
      browserLogs: [],
    };

    Object.assign(this, defaults, data);

    // Extract headings from HTML if not provided
    if (this.html && (!this.h1 || !this.h2 || !this.h3 || !this.h4)) {
      const extractedHeadings = this.extractHeadings(this.html);
      if (!this.h1 && extractedHeadings.h1) this.h1 = extractedHeadings.h1;
      if (!this.h2 && extractedHeadings.h2) this.h2 = extractedHeadings.h2;
      if (!this.h3 && extractedHeadings.h3) this.h3 = extractedHeadings.h3;
      if (!this.h4 && extractedHeadings.h4) this.h4 = extractedHeadings.h4;
    }

    // Automatically save artifacts when ActionResult is created
    this.saveBrowserLogs();
    this.saveHtmlOutput();
  }

  /**
   * Extract headings from HTML content
   */
  private extractHeadings(html: string): {
    h1?: string;
    h2?: string;
    h3?: string;
    h4?: string;
  } {
    const headings: { h1?: string; h2?: string; h3?: string; h4?: string } = {};

    // Extract h1
    const h1Match = html.match(/<h1[^>]*>(.*?)<\/h1>/i);
    if (h1Match) {
      headings.h1 = h1Match[1].replace(/<[^>]*>/g, '').trim();
    }

    // Extract h2
    const h2Match = html.match(/<h2[^>]*>(.*?)<\/h2>/i);
    if (h2Match) {
      headings.h2 = h2Match[1].replace(/<[^>]*>/g, '').trim();
    }

    // Extract h3
    const h3Match = html.match(/<h3[^>]*>(.*?)<\/h3>/i);
    if (h3Match) {
      headings.h3 = h3Match[1].replace(/<[^>]*>/g, '').trim();
    }

    // Extract h4
    const h4Match = html.match(/<h4[^>]*>(.*?)<\/h4>/i);
    if (h4Match) {
      headings.h4 = h4Match[1].replace(/<[^>]*>/g, '').trim();
    }

    return headings;
  }

  isMatchedBy(state: WebPageState): boolean {
    let isRelevant = false;
    if (!this.url) {
      return false;
    }

    isRelevant = this.matchesPattern(
      this.extractStatePath(state.url),
      this.extractStatePath(this.url)
    );
    if (!isRelevant) {
      return false;
    }
    if (
      isRelevant &&
      state.h1 &&
      this.h1 &&
      this.matchesPattern(state.h1, this.h1)
    ) {
      isRelevant = true;
    }
    if (
      isRelevant &&
      state.h2 &&
      this.h2 &&
      this.matchesPattern(state.h2, this.h2)
    ) {
      isRelevant = true;
    }
    if (
      isRelevant &&
      state.h3 &&
      this.h3 &&
      this.matchesPattern(state.h3, this.h3)
    ) {
      isRelevant = true;
    }
    return isRelevant;
  }

  private extractStatePath(url: string): string {
    if (url.startsWith('/')) {
      return url;
    }
    try {
      const urlObj = new URL(url);
      return urlObj.pathname + urlObj.hash;
    } catch {
      return url;
    }
  }

  async simplifiedHtml(): Promise<string> {
    return await minifyHtml(removeNonInteractiveElements(this.html));
  }

  static fromState(state: WebPageState): ActionResult {
    let html = '';
    let screenshot: Buffer | undefined;
    let browserLogs: any[] = [];

    if (state.htmlFile) {
      html = ActionResult.loadHtmlFromFile(state.htmlFile) || '';
    }

    if (state.screenshotFile) {
      screenshot = ActionResult.loadScreenshotFromFile(state.screenshotFile);
    }

    if (state.logFile) {
      browserLogs = ActionResult.loadBrowserLogsFromFile(state.logFile);
    }

    const actionResultData: any = {
      html,
      url: state.fullUrl || state.url,
      title: state.title,
      screenshot,
      browserLogs,
    };

    if (state.timestamp) {
      actionResultData.timestamp = state.timestamp;
    }

    return new ActionResult(actionResultData);
  }

  private static loadHtmlFromFile(htmlFile: string): string | null {
    try {
      const filePath = join('output', htmlFile);
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, 'utf8');
      }
      return null;
    } catch (error) {
      console.error('Failed to load HTML from file:', error);
      return null;
    }
  }

  private static loadScreenshotFromFile(
    screenshotFile: string
  ): Buffer | undefined {
    try {
      const filePath = join('output', screenshotFile);
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath);
      }
      return undefined;
    } catch (error) {
      console.error('Failed to load screenshot from file:', error);
      return undefined;
    }
  }

  private static loadBrowserLogsFromFile(logFile: string): any[] {
    try {
      const filePath = join('output', logFile);
      if (fs.existsSync(filePath)) {
        const logContent = fs.readFileSync(filePath, 'utf8');
        return logContent
          .split('\n')
          .filter((line) => line.trim())
          .map((line) => {
            const match = line.match(/\[([^\]]+)\] (\w+): (.+)/);
            if (match) {
              return {
                timestamp: match[1],
                type: match[2].toLowerCase(),
                text: match[3],
                level: match[2].toLowerCase(),
                message: match[3],
              };
            }
            return { text: line, type: 'log', level: 'log', message: line };
          });
      }
      return [];
    } catch (error) {
      console.error('Failed to load browser logs from file:', error);
      return [];
    }
  }

  toAiContext(): string {
    const parts: string[] = [];

    if (this.url) {
      parts.push(`<url>${this.url}</url>`);
    }

    if (this.title) {
      parts.push(`<title>${this.title}</title>`);
    }

    if (this.h1) {
      parts.push(`<h1>${this.h1}</h1>`);
    }

    if (this.h2) {
      parts.push(`<h2>${this.h2}</h2>`);
    }

    if (this.h3) {
      parts.push(`<h3>${this.h3}</h3>`);
    }

    if (this.h4) {
      parts.push(`<h4>${this.h4}</h4>`);
    }

    return parts.join('\n');
  }

  get relativeUrl(): string | null {
    if (!this.url) return null;

    try {
      const urlObj = new URL(this.url);
      const path = urlObj.pathname.replace(/\/$/, '') || '/';
      const hash = urlObj.hash || '';
      return path + hash;
    } catch {
      // If URL parsing fails, assume it's already a relative URL
      return this.url;
    }
  }

  getStateHash(): string {
    const parts: string[] = [];

    parts.push(this.relativeUrl || '/');

    const headings = ['h1', 'h2'];

    for (const heading of headings) {
      const value = this[heading as keyof this] as string;
      if (value) {
        parts.push(`${heading}_${value}`);
      }
    }

    let stateString = parts
      .map((part) => part.substring(0, 100))
      .join('_')
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .toLowerCase();

    if (stateString.length > 200) {
      stateString = stateString.substring(0, 200);
      if (stateString.endsWith('_')) {
        stateString = stateString.slice(0, -1);
      }
    }

    return stateString;
  }

  private saveBrowserLogs(): void {
    if (!this.browserLogs || this.browserLogs.length === 0) return;

    try {
      const outputDir = 'output';
      const stateHash = this.getStateHash();
      const filename = `${stateHash}.log`;
      const filePath = join(outputDir, filename);

      // Ensure output directory exists
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Format logs for saving
      const formattedLogs = this.browserLogs.map((log: any) => {
        const timestamp = new Date().toISOString();
        const level = (log.type || log.level || 'LOG').toUpperCase();
        const message = log.text || log.message || String(log);
        return `[${timestamp}] ${level}: ${message}`;
      });

      // Save log content to file
      const logContent = `${formattedLogs.join('\n')}\n`;
      fs.writeFileSync(filePath, logContent, 'utf8');
    } catch (error) {
      // Silently fail to avoid breaking the main flow
      console.error('Failed to save browser logs:', error);
    }
  }

  private saveHtmlOutput(): void {
    try {
      const outputDir = 'output';
      const stateHash = this.getStateHash();
      const filename = `${stateHash}.html`;
      const filePath = join(outputDir, filename);

      // Ensure output directory exists
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Save HTML content to file
      fs.writeFileSync(filePath, this.html, 'utf8');
    } catch (error) {
      // Silently fail to avoid breaking the main flow
      console.error('Failed to save HTML output:', error);
    }
  }

  /**
   * Use micromatch for glob matching
   * Supports: *, ?, [abc], [a-z], **, and many more advanced patterns
   */
  private globMatch(pattern: string, str: string): boolean {
    return micromatch.isMatch(str, pattern);
  }

  /**
   * Check if a pattern matches an actual value
   * Supports multiple modes:
   * - If pattern starts with '^', treat as regex: ^/user/\d+$
   * - If pattern starts and ends with '~', treat as regex: ~/user/\d+~
   * - Otherwise, use glob matching via micromatch with advanced patterns
   * Can be extended to match h1, h2, h3, title, etc.
   */
  private matchesPattern(pattern: string, actualValue: string): boolean {
    if (pattern === '*') return true;
    if (pattern?.toLowerCase() === actualValue?.toLowerCase()) return true;

    // If pattern starts with '^', treat as regex
    if (pattern.startsWith('^')) {
      try {
        const regexPattern = pattern.slice(1);
        const regex = new RegExp(regexPattern);
        return regex.test(actualValue);
      } catch (error) {
        debugLog(`Invalid regex pattern: ${pattern}`, error);
        return false;
      }
    }

    // If pattern starts and ends with '~', treat as regex
    if (
      pattern.startsWith('~') &&
      pattern.endsWith('~') &&
      pattern.length > 2
    ) {
      try {
        const regexPattern = pattern.slice(1, -1);
        const regex = new RegExp(regexPattern);
        return regex.test(actualValue);
      } catch (error) {
        debugLog(`Invalid regex pattern: ${pattern}`, error);
        return false;
      }
    }

    // Use glob matching for everything else
    try {
      return this.globMatch(pattern, actualValue);
    } catch (error) {
      debugLog(`Invalid glob pattern: ${pattern}`, error);
      return false;
    }
  }
}
