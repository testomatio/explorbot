import fs from 'node:fs';
import { join } from 'node:path';
import micromatch from 'micromatch';
import { ConfigParser, type HtmlConfig } from './config.ts';
import type { Link, WebPageState } from './state-manager.ts';
import { diffAriaSnapshots, summarizeInteractiveNodes } from './utils/aria.ts';
import { type HtmlDiffResult, htmlDiff } from './utils/html-diff.ts';
import { extractHeadings, extractLinks, extractTargetedHtml, htmlCombinedSnapshot, htmlMinimalUISnapshot, htmlTextSnapshot, minifyHtml } from './utils/html.ts';
import { createDebug } from './utils/logger.ts';

const debugLog = createDebug('explorbot:state');

interface ActionResultData extends WebPageState {
  html?: string;
  fullUrl?: string | undefined;
  screenshot?: Buffer;
  screenshotFile?: string;
  logFile?: string;
  htmlFile?: string;
  title?: string;
  timestamp?: Date;
  error?: string | null;
  h1?: string | undefined;
  h2?: string | undefined;
  h3?: string | undefined;
  h4?: string | undefined;
  browserLogs?: any[];
  iframeSnapshots?: Array<{ src: string; html: string; id?: string }>;
  ariaSnapshot?: string | null;
  ariaSnapshotFile?: string;
  links?: Link[];
}

export interface PageDiff {
  urlChanged: boolean;
  previousUrl?: string;
  currentUrl: string;
  ariaChanges?: string | null;
  htmlChanges?: string | null;
}

export interface ToolResultMetadata {
  url: string;
  locator: string;
  targetedHtml: string;
  pageDiff: PageDiff | null;
}

export class ActionResult implements ActionResultData {
  public id?: number;
  public title = '';
  public error: string | null = null;
  public timestamp: Date = new Date();
  public h1: string | undefined = undefined;
  public h2: string | undefined = undefined;
  public h3: string | undefined = undefined;
  public h4: string | undefined = undefined;
  public url = '';
  public fullUrl: string | undefined = undefined;
  public browserLogs: any[] = [];
  public iframeSnapshots: Array<{ src: string; html: string; id?: string }> = [];
  readonly screenshotFile: string | undefined = undefined;
  private _screenshot: Buffer | undefined = undefined;
  readonly htmlFile: string | undefined = undefined;
  private _html: string | undefined = undefined;
  readonly logFile: string | undefined = undefined;
  private _browserLogs: any[] | undefined = undefined;
  readonly ariaSnapshotFile: string | undefined = undefined;
  private _ariaSnapshot: string | null | undefined = undefined;
  private _lastExtractedHtml: string | undefined = undefined;
  notes: any;
  public links: Link[] = [];

  constructor(data: ActionResultData) {
    this.id = data.id;
    this.timestamp = data.timestamp ?? new Date();
    this.url = data.url ?? '';
    this.fullUrl = data.fullUrl;
    this.title = data.title ?? '';
    this.error = data.error ?? null;
    this.browserLogs = data.browserLogs ?? [];
    this.iframeSnapshots = data.iframeSnapshots ?? [];
    this.notes = data.notes ?? [];

    // Set readonly properties
    if (data.screenshotFile !== undefined) {
      this.screenshotFile = data.screenshotFile;
    }
    if (data.htmlFile !== undefined) {
      this.htmlFile = data.htmlFile;
    }
    if (data.logFile !== undefined) {
      this.logFile = data.logFile;
    }
    if (data.ariaSnapshotFile !== undefined) {
      this.ariaSnapshotFile = data.ariaSnapshotFile;
    }

    // Store HTML and browser logs in private properties if provided
    if (data.html !== undefined) {
      this._html = data.html;
    }

    if (data.browserLogs !== undefined) {
      this._browserLogs = data.browserLogs;
    }
    if (data.screenshot !== undefined) {
      this._screenshot = data.screenshot;
    }
    if (data.ariaSnapshot !== undefined) {
      this._ariaSnapshot = data.ariaSnapshot;
    }

    if (!this.fullUrl && this.url && this.url !== '') {
      this.fullUrl = this.url;
    }

    this.extractHeadings(this.html);

    if (data.links) {
      this.links = data.links;
    } else if (this._html) {
      this.links = extractLinks(this._html);
    }

    if (this.url && this.url !== '') {
      this.url = this.extractStatePath(this.url);
    }
  }

  get hash() {
    return this.getStateHash();
  }

  get html(): string {
    if (this._html) return this._html;
    if (this.htmlFile) {
      return (this._html = ActionResult.loadHtmlFromFile(this.htmlFile) || '');
    }
    return '';
  }

  set html(value: string) {
    this._html = value;
  }

  get screenshot(): Buffer | undefined {
    if (this._screenshot) {
      return this._screenshot;
    }
    if (this.screenshotFile) {
      return ActionResult.loadScreenshotFromFile(this.screenshotFile);
    }
    return undefined;
  }

  get browserLogsContent(): any[] {
    if (this._browserLogs !== undefined) {
      return this._browserLogs;
    }
    if (this.logFile) {
      return ActionResult.loadBrowserLogsFromFile(this.logFile);
    }
    return [];
  }

  get ariaSnapshot(): string | null {
    if (this._ariaSnapshot !== undefined) {
      return this._ariaSnapshot;
    }
    if (!this.ariaSnapshotFile) {
      this._ariaSnapshot = null;
      return null;
    }
    this._ariaSnapshot = ActionResult.loadAriaSnapshotFromFile(this.ariaSnapshotFile);
    return this._ariaSnapshot;
  }

  set ariaSnapshot(value: string | null) {
    this._ariaSnapshot = value;
  }

  private extractHeadings(html: string): void {
    if (!html) return;

    if (this._lastExtractedHtml === html) return;

    const extracted = extractHeadings(html);

    if (!this.h1 && extracted.h1) this.h1 = extracted.h1;
    if (!this.h2 && extracted.h2) this.h2 = extracted.h2;
    if (!this.h3 && extracted.h3) this.h3 = extracted.h3;
    if (!this.h4 && extracted.h4) this.h4 = extracted.h4;

    this._lastExtractedHtml = html;
  }

  isSameUrl(state: WebPageState): boolean {
    if (!this.url || this.url === '') {
      return false;
    }
    return this.extractStatePath(state.url) === this.extractStatePath(this.url);
  }

  isMatchedBy(state: WebPageState): boolean {
    if (!this.url || this.url === '') {
      return false;
    }

    const isRelevant = this.matchesPattern(this.extractStatePath(state.url), this.extractStatePath(this.url));
    if (!isRelevant) {
      return false;
    }

    // If headings are provided in state, they must match
    if (state.h1 && this.h1 && !this.matchesPattern(this.h1, state.h1)) {
      return false;
    }
    if (state.h2 && this.h2 && !this.matchesPattern(this.h2, state.h2)) {
      return false;
    }
    if (state.h3 && this.h3 && !this.matchesPattern(this.h3, state.h3)) {
      return false;
    }

    return true;
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

  async simplifiedHtml(htmlConfig?: HtmlConfig): Promise<string> {
    const normalizedConfig = this.normalizeHtmlConfig(htmlConfig);
    return await minifyHtml(htmlMinimalUISnapshot(this.html ?? '', normalizedConfig?.minimal));
  }

  async combinedHtml(htmlConfig?: HtmlConfig): Promise<string> {
    const normalizedConfig = this.normalizeHtmlConfig(htmlConfig);
    const combinedHtml = await minifyHtml(htmlCombinedSnapshot(this.html ?? '', normalizedConfig?.combined));
    debugLog(`----${this.url}----`);
    debugLog(`Combined HTML: \n${combinedHtml}`);
    debugLog('----');
    return combinedHtml;
  }

  async textHtml(htmlConfig?: HtmlConfig): Promise<string> {
    const normalizedConfig = this.normalizeHtmlConfig(htmlConfig);
    return await minifyHtml(htmlTextSnapshot(this.html ?? '', normalizedConfig?.text));
  }

  private normalizeHtmlConfig(htmlConfig?: HtmlConfig): HtmlConfig | undefined {
    if (htmlConfig) {
      return htmlConfig;
    }
    const parser = ConfigParser.getInstance();
    return parser.getConfig().html;
  }

  static fromState(state: WebPageState): ActionResult {
    let html: string | undefined = undefined;
    let screenshot: Buffer | undefined = undefined;
    let browserLogs: any[] | undefined = undefined;

    // Only load from files if the data isn't already provided
    if (state.htmlFile && !state.html) {
      html = ActionResult.loadHtmlFromFile(state.htmlFile) || '';
    } else if (state.html) {
      html = state.html;
    }

    if (state.logFile) {
      browserLogs = ActionResult.loadBrowserLogsFromFile(state.logFile);
    }

    if (state.screenshotFile) {
      screenshot = ActionResult.loadScreenshotFromFile(state.screenshotFile);
    }

    let ariaSnapshot = state.ariaSnapshot ?? null;

    if (!ariaSnapshot && state.ariaSnapshotFile) {
      ariaSnapshot = ActionResult.loadAriaSnapshotFromFile(state.ariaSnapshotFile);
    }

    const actionResultData: any = {
      ...state,
      html,
      url: state.fullUrl || state.url || '',
      title: state.title,
      browserLogs,
      screenshot,
      ariaSnapshot,
    };

    if (state.timestamp) {
      actionResultData.timestamp = state.timestamp;
    }

    return new ActionResult(actionResultData);
  }

  private static loadHtmlFromFile(htmlFile: string): string | null {
    try {
      const filePath = join(ConfigParser.getInstance().getOutputDir(), htmlFile);
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, 'utf8');
      }
      return null;
    } catch (error) {
      console.error('Failed to load HTML from file:', error);
      return null;
    }
  }

  private static loadScreenshotFromFile(screenshotFile: string): Buffer | undefined {
    try {
      const filePath = join(ConfigParser.getInstance().getOutputDir(), screenshotFile);
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

  private static loadAriaSnapshotFromFile(ariaSnapshotFile: string): string | null {
    try {
      const filePath = join(ConfigParser.getInstance().getOutputDir(), ariaSnapshotFile);
      if (!fs.existsSync(filePath)) {
        return null;
      }

      const content = fs.readFileSync(filePath, 'utf8');
      const trimmed = content.trim();
      if (!trimmed) {
        return null;
      }

      return trimmed.endsWith('\n') ? trimmed : `${trimmed}\n`;
    } catch (error) {
      console.error('Failed to load aria snapshot from file:', error);
      return null;
    }
  }

  toAiContext(): string {
    const parts: string[] = [];

    if (this.url && this.url !== '') {
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

    if (this.notes.length > 0) {
      parts.push(`<notes>${this.notes.join('\n')}</notes>`);
    }

    const ariaSummary = summarizeInteractiveNodes(this.ariaSnapshot);
    if (ariaSummary.length > 0) {
      parts.push(`<aria>\n${ariaSummary.map((item) => `- ${item}`).join('\n')}</aria>`);
    }

    if (this.links.length > 0) {
      const linksToShow = this.links.slice(0, 20);
      const linksList = linksToShow.map((link) => `- [${link.title}](${link.url})`).join('\n');
      const suffix = this.links.length > 20 ? `\n... and ${this.links.length - 20} more` : '';
      parts.push(`<links>\n${linksList}${suffix}</links>`);
    }

    debugLog(`AI context: \n${parts.join('\n')}`);

    return parts.join('\n');
  }

  get relativeUrl(): string | null {
    if (!this.url || this.url === '') return null;

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

    parts.push(this.relativeUrl || this.url || '/');

    this.extractHeadings(this.html);

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
    const logs = this.browserLogsContent;
    if (!logs || logs.length === 0) return;

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
      const formattedLogs = logs.map((log: any) => {
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

  async diff(previousState: ActionResult | null): Promise<Diff> {
    return new Diff(this, previousState);
  }

  async toToolResult(previousState: ActionResult | null, locator: string): Promise<ToolResultMetadata> {
    const result: ToolResultMetadata = {
      url: previousState?.url || '',
      locator,
      targetedHtml: '',
      pageDiff: null,
    };

    if (previousState) {
      const html = await previousState.simplifiedHtml();
      result.targetedHtml = extractTargetedHtml(html, locator);
    }

    if (previousState?.id !== undefined && this.id === previousState.id) {
      return result;
    }

    const urlChanged = previousState ? !this.isSameUrl({ url: previousState.url }) : true;

    if (!previousState) {
      result.pageDiff = {
        urlChanged: true,
        currentUrl: this.url,
      };
      return result;
    }

    const diff = await this.diff(previousState);
    await diff.calculate();

    const pageDiff: PageDiff = {
      urlChanged,
      previousUrl: previousState.url,
      currentUrl: this.url,
    };

    if (diff.ariaChanged) {
      pageDiff.ariaChanges = diff.ariaChanged;
    }

    if (diff.htmlDiff && diff.htmlSubtree) {
      pageDiff.htmlChanges = await minifyHtml(diff.htmlSubtree);
    }

    result.pageDiff = pageDiff;
    return result;
  }

  private globMatch(pattern: string, str: string): boolean {
    return micromatch.isMatch(str, pattern);
  }

  /**
   * Check if a pattern matches an actual value
   * Supports multiple modes:
   * - If pattern starts with '^', treat as regex: ^/user/\d+$
   * - If pattern starts and ends with '~', treat as regex: ~/user/\d+~
   * - Special handling for /* patterns to match both exact path and sub-paths
   * - Otherwise, use glob matching via micromatch with advanced patterns
   * Can be extended to match h1, h2, h3, title, etc.
   */
  private matchesPattern(pattern: string, actualValue: string): boolean {
    if (pattern === '*') return true;
    if (pattern?.toLowerCase() === actualValue?.toLowerCase()) return true;

    // Special handling for /* patterns - they should match both exact path and sub-paths
    if (pattern.endsWith('/*')) {
      const basePattern = pattern.slice(0, -2); // Remove /*
      if (actualValue === basePattern) return true;
      if (actualValue.startsWith(`${basePattern}/`)) return true;
    }

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
    if (pattern.startsWith('~') && pattern.endsWith('~') && pattern.length > 2) {
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

export class Diff {
  private _htmlDiffResult: HtmlDiffResult | null = null;
  private _ariaDiffResult: string | null = null;
  private _isSameUrl: boolean;
  private _urlChanged: boolean;

  constructor(
    private current: ActionResult,
    private previous: ActionResult | null
  ) {
    this._isSameUrl = previous ? current.isSameUrl({ url: previous.url }) : false;
    this._urlChanged = !this._isSameUrl;
  }

  hasChanges(): boolean {
    if (!this.previous) return false;
    if (this._urlChanged) return true;

    const hasHtmlChanges = this._htmlDiffResult && (this._htmlDiffResult.added.length > 0 || this._htmlDiffResult.removed.length > 0);

    const hasAriaChanges = this._ariaDiffResult !== null;

    return hasHtmlChanges || hasAriaChanges;
  }

  isSameUrl(): boolean {
    return this._isSameUrl;
  }

  urlHasChanged(): boolean {
    return this._urlChanged;
  }

  get htmlSubtree(): string {
    if (!this._htmlDiffResult) return '';
    return this._htmlDiffResult.subtree;
  }

  get ariaChanged(): string | null {
    return this._ariaDiffResult;
  }

  get ariaRemoved(): string | null {
    return this._ariaDiffResult;
  }

  get htmlDiff(): HtmlDiffResult | null {
    return this._htmlDiffResult;
  }

  get ariaDiff(): string | null {
    return this._ariaDiffResult;
  }

  async calculate(): Promise<void> {
    if (!this.previous) return;

    if (this._isSameUrl) {
      this._htmlDiffResult = await htmlDiff(this.previous.html, this.current.html, ConfigParser.getInstance().getConfig().html);
    }

    this._ariaDiffResult = diffAriaSnapshots(this.previous.ariaSnapshot, this.current.ariaSnapshot);
  }
}
