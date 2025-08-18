import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import debug from 'debug';
import matter from 'gray-matter';
import micromatch from 'micromatch';
import type { ActionResult } from './action-result.js';

const debugLog = debug('explorbot:state');

export interface WebPageState {
  /** URL path without domain, including hash: /path/to/page#section */
  url: string;
  /** Page title */
  title: string;
  /** Full URL for reference */
  fullUrl?: string;
  /** Timestamp when state was captured */
  timestamp?: Date;
  /** Hash of the state for unique identification */
  hash?: string;
  /** HTML file path */
  htmlFile?: string;
  /** Screenshot file path */
  screenshotFile?: string;
  /** Log file path */
  logFile?: string;
  /** HTML content */
  html?: string;
  /** Page headings */
  h1?: string;
  h2?: string;
  h3?: string;
  h4?: string;
}

export interface StateTransition {
  /** Previous state (null if this is the first state) */
  fromState: WebPageState | null;
  /** Current state */
  toState: WebPageState;
  /** Code block that caused the transition */
  codeBlock: string;
  /** Timestamp of the transition */
  timestamp: Date;
  /** Any error that occurred during transition */
  error?: string;
  /** What triggered the state change */
  trigger: 'manual' | 'navigation' | 'automatic';
}

export type StateChangeListener = (event: StateTransition) => void;

export interface KnowledgeFile {
  /** File path */
  filePath: string;
  /** URL pattern from frontmatter (supports wildcards) */
  urlPattern: string;
  /** Parsed frontmatter */
  frontmatter: any;
  /** Markdown content */
  content: string;
}

export class StateManager {
  private currentState: WebPageState | null = null;
  private stateHistory: StateTransition[] = [];
  private knowledgeDir: string;
  private experienceDir: string;
  private knowledgeCache: KnowledgeFile[] = [];
  private lastKnowledgeScan: Date | null = null;
  private stateChangeListeners: StateChangeListener[] = [];

  constructor(knowledgeDir = 'knowledge', experienceDir = 'experience') {
    this.knowledgeDir = knowledgeDir;
    this.experienceDir = experienceDir;
  }

  /**
   * Subscribe to state change events
   */
  onStateChange(listener: StateChangeListener): () => void {
    this.stateChangeListeners.push(listener);

    // Return unsubscribe function
    return () => {
      const index = this.stateChangeListeners.indexOf(listener);
      if (index > -1) {
        this.stateChangeListeners.splice(index, 1);
      }
    };
  }

  /**
   * Emit state change event to all listeners
   */
  private emitStateChange(event: StateTransition): void {
    this.stateChangeListeners.forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        debugLog('Error in state change listener:', error);
      }
    });
  }

  /**
   * Extract state path from full URL
   * Removes domain, port, protocol, and query params
   * Keeps path and hash: /path/to/page#section
   */
  private extractStatePath(fullUrl: string): string {
    try {
      const url = new URL(fullUrl);
      const path = url.pathname || '/';
      const hash = url.hash || '';
      return path + hash;
    } catch {
      // If URL parsing fails, return as-is
      return fullUrl;
    }
  }

  /**
   * Update current state from ActionResult
   * Returns the new state, or existing state if hash hasn't changed
   */
  updateState(
    actionResult: ActionResult,
    codeBlock?: string,
    files?: { htmlFile: string; screenshotFile: string; logFile: string },
    trigger: 'manual' | 'navigation' | 'automatic' = 'manual'
  ): WebPageState {
    const path = this.extractStatePath(actionResult.url || '/');
    const stateHash = actionResult.getStateHash();

    // Check if state has actually changed
    if (this.currentState && this.currentState.hash === stateHash) {
      debugLog(`State unchanged: ${this.currentState.url} (${stateHash})`);
      return this.currentState;
    }

    const newState: WebPageState = {
      url: path,
      title: actionResult.title || 'Unknown Page',
      fullUrl: actionResult.url || '',
      timestamp: actionResult.timestamp,
      hash: stateHash,
      htmlFile: files?.htmlFile,
      screenshotFile: files?.screenshotFile,
      logFile: files?.logFile,
      html: actionResult.html,
      h1: actionResult.h1 || undefined,
      h2: actionResult.h2 || undefined,
      h3: actionResult.h3 || undefined,
      h4: actionResult.h4 || undefined,
    };

    // Create transition record
    const transition: StateTransition = {
      fromState: this.currentState,
      toState: newState,
      codeBlock: codeBlock || '',
      timestamp: new Date(),
      trigger,
    };

    this.stateHistory.push(transition);
    const previousState = this.currentState;
    this.currentState = newState;

    // Emit state change event
    this.emitStateChange(transition);

    debugLog(
      `State updated: ${this.currentState.url} (${this.currentState.hash})`
    );

    return newState;
  }

  /**
   * Create a new state from basic data
   */
  newState(state: Partial<WebPageState>): WebPageState {
    return {
      url: state.url || '',
      title: state.title || '',
      ...state,
    };
  }

  /**
   * Update state from basic data (for navigation events)
   */
  updateStateFromBasic(
    url: string,
    title?: string,
    trigger: 'manual' | 'navigation' | 'automatic' = 'navigation'
  ): WebPageState {
    const path = this.extractStatePath(url);
    const newState: WebPageState = {
      url: path,
      title: title || 'Unknown Page',
      fullUrl: url,
      timestamp: new Date(),
      hash: this.generateBasicHash(path, title),
    };

    // Check if state has actually changed
    if (this.currentState && this.currentState.hash === newState.hash) {
      debugLog(`State unchanged: ${this.currentState.url} (${newState.hash})`);
      return this.currentState;
    }

    // Create transition record
    const transition: StateTransition = {
      fromState: this.currentState,
      toState: newState,
      codeBlock: '',
      timestamp: new Date(),
      trigger,
    };

    this.stateHistory.push(transition);
    const previousState = this.currentState;
    this.currentState = newState;

    // Emit state change event
    this.emitStateChange(transition);

    debugLog(
      `State updated from basic: ${this.currentState.url} (${this.currentState.hash})`
    );

    return newState;
  }

  /**
   * Generate a basic hash for state comparison
   */
  private generateBasicHash(url: string, title?: string): string {
    const parts = [url];
    if (title) {
      parts.push(`title_${title}`);
    }

    return parts
      .join('_')
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .toLowerCase()
      .substring(0, 200);
  }

  /**
   * Get current state
   */
  getCurrentState(): WebPageState | null {
    return this.currentState;
  }

  /**
   * Check if state has changed since a given state
   */
  hasStateChanged(previousState: WebPageState | null): boolean {
    if (!previousState && !this.currentState) return false;
    if (!previousState || !this.currentState) return true;
    return previousState.hash !== this.currentState.hash;
  }

  /**
   * Compare two states by their hash
   */
  statesEqual(
    state1: WebPageState | null,
    state2: WebPageState | null
  ): boolean {
    if (!state1 && !state2) return true;
    if (!state1 || !state2) return false;
    return state1.hash === state2.hash;
  }

  /**
   * Create a state from ActionResult without updating current state
   * Useful for comparisons
   */
  createStateFromActionResult(actionResult: ActionResult): WebPageState {
    const path = this.extractStatePath(actionResult.url || '/');
    return {
      url: path,
      title: actionResult.title || 'Unknown Page',
      fullUrl: actionResult.url || '',
      timestamp: actionResult.timestamp,
      hash: actionResult.getStateHash(),
    };
  }

  /**
   * Get state history
   */
  getStateHistory(): StateTransition[] {
    return [...this.stateHistory];
  }

  /**
   * Get the last N transitions
   */
  getRecentTransitions(count = 5): StateTransition[] {
    return this.stateHistory.slice(-count);
  }

  /**
   * Scan knowledge directory for .md files and cache them
   */
  private scanKnowledgeFiles(): void {
    const now = new Date();

    // Only rescan every 30 seconds to avoid excessive file I/O
    if (
      this.lastKnowledgeScan &&
      now.getTime() - this.lastKnowledgeScan.getTime() < 30000
    ) {
      return;
    }

    this.knowledgeCache = [];

    if (!existsSync(this.knowledgeDir)) {
      debugLog(`Knowledge directory not found: ${this.knowledgeDir}`);
      return;
    }

    try {
      const files = readdirSync(this.knowledgeDir, { recursive: true })
        .filter((file) => typeof file === 'string' && file.endsWith('.md'))
        .map((file) => join(this.knowledgeDir, file as string));

      for (const filePath of files) {
        try {
          const fileContent = readFileSync(filePath, 'utf8');
          const parsed = matter(fileContent);

          const urlPattern = parsed.data.url || parsed.data.path || '*';

          this.knowledgeCache.push({
            filePath,
            urlPattern,
            frontmatter: parsed.data,
            content: parsed.content,
          });

          debugLog(
            `Loaded knowledge file: ${filePath} (pattern: ${urlPattern})`
          );
        } catch (error) {
          debugLog(`Failed to load knowledge file ${filePath}:`, error);
        }
      }

      this.lastKnowledgeScan = now;
      debugLog(`Scanned ${this.knowledgeCache.length} knowledge files`);
    } catch (error) {
      debugLog('Failed to scan knowledge directory:', error);
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
    if (pattern === actualValue) return true;

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

  /**
   * Get relevant knowledge files for current state
   */
  getRelevantKnowledge(): KnowledgeFile[] {
    if (!this.currentState) return [];

    this.scanKnowledgeFiles();

    return this.knowledgeCache.filter((knowledge) =>
      this.matchesPattern(knowledge.urlPattern, this.currentState!.url)
    );
  }

  /**
   * Get relevant experience files for current state
   */
  getRelevantExperience(): string[] {
    if (!this.currentState || !existsSync(this.experienceDir)) {
      return [];
    }

    try {
      const files = readdirSync(this.experienceDir)
        .filter((file) => file.endsWith('.md'))
        .map((file) => join(this.experienceDir, file));

      const relevantFiles: string[] = [];

      for (const filePath of files) {
        try {
          const fileContent = readFileSync(filePath, 'utf8');
          const parsed = matter(fileContent);

          if (parsed.data.url) {
            const experiencePath = this.extractStatePath(parsed.data.url);
            if (experiencePath === this.currentState.url) {
              relevantFiles.push(parsed.content);
            }
          }
        } catch (error) {
          debugLog(`Failed to read experience file ${filePath}:`, error);
        }
      }

      return relevantFiles;
    } catch (error) {
      debugLog('Failed to scan experience directory:', error);
      return [];
    }
  }

  /**
   * Get all context for current state (knowledge + experience)
   */
  getCurrentContext(): {
    state: WebPageState;
    knowledge: KnowledgeFile[];
    experience: string[];
    recentTransitions: StateTransition[];
  } {
    if (!this.currentState) {
      throw new Error('No current state available');
    }

    return {
      state: this.currentState,
      knowledge: this.getRelevantKnowledge(),
      experience: this.getRelevantExperience(),
      recentTransitions: this.getRecentTransitions(),
    };
  }

  /**
   * Check if we've been in this state before
   */
  hasVisitedState(path: string): boolean {
    return this.stateHistory.some(
      (transition) => transition.toState.url === path
    );
  }

  /**
   * Get how many times we've visited a specific path
   */
  getVisitCount(path: string): number {
    return this.stateHistory.filter(
      (transition) => transition.toState.url === path
    ).length;
  }

  /**
   * Find the most recent transition to a specific path
   */
  getLastVisitToPath(path: string): StateTransition | null {
    for (let i = this.stateHistory.length - 1; i >= 0; i--) {
      if (this.stateHistory[i].toState.url === path) {
        return this.stateHistory[i];
      }
    }
    return null;
  }

  /**
   * Load HTML content from file
   */
  loadHtmlFromFile(htmlFile: string): string | null {
    try {
      const filePath = join('output', htmlFile);
      if (existsSync(filePath)) {
        return readFileSync(filePath, 'utf8');
      }
      return null;
    } catch (error) {
      debugLog('Failed to load HTML from file:', error);
      return null;
    }
  }

  /**
   * Clear state history (useful for testing or reset)
   */
  clearHistory(): void {
    this.stateHistory = [];
    this.currentState = null;
    debugLog('State history cleared');
  }

  /**
   * Get the number of active state change listeners
   */
  getListenerCount(): number {
    return this.stateChangeListeners.length;
  }

  /**
   * Clear all state change listeners
   */
  clearListeners(): void {
    this.stateChangeListeners = [];
    debugLog('All state change listeners cleared');
  }
}
