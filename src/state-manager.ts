import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import matter from 'gray-matter';
import { ActionResult } from './action-result.js';
import { ConfigParser } from './config.js';
import { ExperienceTracker } from './experience-tracker.js';
import { htmlTextSnapshot } from './utils/html.js';
import { createDebug, tag } from './utils/logger.js';

const debugLog = createDebug('explorbot:state');

export interface WebPageState {
  /** Unique incremental state identifier */
  id?: number;
  /** URL path without domain, including hash: /path/to/page#section */
  url: string;
  /** Page title */
  title?: string;
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

  notes?: string[];
  /** Page headings */
  h1?: string;
  h2?: string;
  h3?: string;
  h4?: string;
  ariaSnapshot?: string | null;
  ariaSnapshotFile?: string;
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

export interface Knowledge extends WebPageState {
  /** File path */
  filePath: string;
  /** Markdown content */
  content: string;
}

export class StateManager {
  private currentState: WebPageState | null = null;
  private stateHistory: StateTransition[] = [];
  private knowledgeCache: Knowledge[] = [];
  private lastKnowledgeScan: Date | null = null;
  private stateChangeListeners: StateChangeListener[] = [];
  private experienceTracker!: ExperienceTracker;
  private knowledgeDir: string;
  private nextStateId = 1;

  constructor() {
    this.experienceTracker = new ExperienceTracker();
    const configParser = ConfigParser.getInstance();
    const config = configParser.getConfig();
    const configPath = configParser.getConfigPath();

    // Resolve knowledge directory relative to the config file location (project root)
    if (configPath) {
      const projectRoot = dirname(configPath);
      this.knowledgeDir = join(projectRoot, config.dirs?.knowledge || 'knowledge');
    } else {
      this.knowledgeDir = config.dirs?.knowledge || 'knowledge';
    }
  }

  getExperienceTracker(): ExperienceTracker {
    return this.experienceTracker;
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
    // Log HTML content when state changes
    if (event.toState.html && event.toState.html !== event.fromState?.html) {
      let htmlContent = event?.toState?.html ?? '';
      htmlContent = htmlTextSnapshot(htmlContent);
      // tag('html').log(`Page HTML for ${event.toState.url}:\n${htmlContent}`);
    }

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
      const result = path + hash;
      return result || '/';
    } catch {
      // If URL parsing fails, return as-is
      return fullUrl || '/';
    }
  }

  /**
   * Update current state from ActionResult and record transition if state changed
   */
  updateState(actionResult: ActionResult, codeBlock?: string, trigger: 'manual' | 'navigation' | 'automatic' = 'manual'): WebPageState {
    const previousState = this.currentState;
    const previousHash = previousState?.hash;

    const newState = actionResult;
    this.currentState = newState;
    this.currentState.id = this.nextStateId++;

    if (actionResult.hash !== previousHash) {
      const transition: StateTransition = {
        fromState: previousState,
        toState: newState,
        codeBlock: codeBlock || '',
        timestamp: new Date(),
        trigger,
      };
      this.stateHistory.push(transition);
      this.emitStateChange(transition);
    }

    debugLog(`State updated: ${this.currentState.url} (${this.currentState.hash})`);

    return newState;
  }

  /**
   * Update state from basic data (for navigation events)
   */
  updateStateFromBasic(url: string, title?: string, trigger: 'manual' | 'navigation' | 'automatic' = 'navigation'): WebPageState {
    const path = this.extractStatePath(url);

    // no extra navigation happened
    if (normalizeUrl(this.currentState?.url || '') === normalizeUrl(path)) {
      return this.currentState!;
    }

    const newState: WebPageState = {
      id: this.nextStateId++,
      url: path,
      title: title || 'Unknown Page',
      fullUrl: url,
      timestamp: new Date(),
      hash: this.generateBasicHash(path, title),
    };

    // Create transition record
    const transition: StateTransition = {
      fromState: this.currentState,
      toState: newState,
      codeBlock: '',
      timestamp: new Date(),
      trigger,
    };

    this.stateHistory.push(transition);
    this.currentState = newState;

    this.emitStateChange(transition);

    debugLog(`State updated from navigation: ${this.currentState.url} (${this.currentState.hash})`);

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
  statesEqual(state1: WebPageState | null, state2: WebPageState | null): boolean {
    if (!state1 && !state2) return true;
    if (!state1 || !state2) return false;
    return state1.hash === state2.hash;
  }

  /**
   * Get state history
   */
  getStateHistory(): StateTransition[] {
    return [...this.stateHistory];
  }

  isInDeadLoop(): boolean {
    const minWindow = 10;
    const increment = 3;
    const stateHashes = this.stateHistory.map((transition) => {
      const state = transition.toState;
      return state.hash || this.generateBasicHash(state.url || '/', state.title);
    });

    debugLog(`Current state hash: ${this.currentState?.hash}`);
    debugLog(`State hashes: ${stateHashes.join(', ')}`);

    if (stateHashes.length < minWindow) {
      return false;
    }

    const currentHash = this.currentState?.hash || stateHashes[stateHashes.length - 1];
    if (!currentHash) {
      return false;
    }

    let windowSize = minWindow;
    let uniqueLimit = 1;

    while (windowSize <= stateHashes.length) {
      const window = stateHashes.slice(-windowSize);
      if (!window.includes(currentHash)) {
        return false;
      }

      const unique = new Map<string, number>();
      for (const hash of window) {
        unique.set(hash, (unique.get(hash) || 0) + 1);
        if (unique.size > uniqueLimit) {
          break;
        }
      }

      if (unique.size <= uniqueLimit) {
        debugLog(`DEAD LOOP DETECTED: ${window.join(', ')}`);
        return true;
      }

      windowSize += increment;
      uniqueLimit += 1;
    }

    return false;
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
    if (this.lastKnowledgeScan && now.getTime() - this.lastKnowledgeScan.getTime() < 30000) {
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
            url: urlPattern,
            ...parsed.data,
            content: parsed.content,
          });

          debugLog(`Loaded knowledge file: ${filePath} (pattern: ${urlPattern})`);
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
   * Get relevant knowledge files for current state
   */
  getRelevantKnowledge(): Knowledge[] {
    if (!this.currentState) return [];

    this.scanKnowledgeFiles();

    const actionResult = ActionResult.fromState(this.currentState);
    return this.knowledgeCache.filter((knowledge) => actionResult.isMatchedBy(knowledge));
  }

  /**
   * Get relevant experience files for current state
   */
  getRelevantExperience(): string[] {
    if (!this.currentState) {
      return [];
    }
    const actionResult = ActionResult.fromState(this.currentState);
    return this.experienceTracker.getRelevantExperience(actionResult).map((experience) => experience.content);
  }

  /**
   * Get all context for current state (knowledge + experience)
   */
  getCurrentContext(): {
    state: WebPageState;
    knowledge: Knowledge[];
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
    return this.stateHistory.some((transition) => normalizeUrl(transition.toState.url) === normalizeUrl(path));
  }

  /**
   * Get how many times we've visited a specific path
   */
  getVisitCount(path: string): number {
    return this.stateHistory.filter((transition) => normalizeUrl(transition.toState.url) === normalizeUrl(path)).length;
  }

  /**
   * Find the most recent transition to a specific path
   */
  getLastVisitToPath(path: string): StateTransition | null {
    for (let i = this.stateHistory.length - 1; i >= 0; i--) {
      if (normalizeUrl(this.stateHistory[i].toState.url) === normalizeUrl(path)) {
        return this.stateHistory[i];
      }
    }
    return null;
  }

  /**
   * Get previous state from history for comparison.
   * If the last transition changed URL, returns the fromState (for URL change detection).
   * Otherwise returns the most recent toState with content (for diffing).
   */
  getPreviousState(): WebPageState | null {
    if (this.stateHistory.length === 0) return null;

    const lastTransition = this.stateHistory[this.stateHistory.length - 1];

    if (lastTransition.fromState?.url !== lastTransition.toState?.url) {
      return lastTransition.fromState;
    }

    for (let i = this.stateHistory.length - 1; i >= 0; i--) {
      const toState = this.stateHistory[i].toState;

      if (!toState) continue;
      if (toState.id === this.currentState?.id) continue;

      if (toState.html || toState.ariaSnapshot) {
        return toState;
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

  /**
   * Complete cleanup of the StateManager instance
   * Clears all state, history, listeners, and caches
   */
  cleanup(): void {
    this.currentState = null;
    this.stateHistory = [];
    this.stateChangeListeners = [];
    this.knowledgeCache = [];
    this.lastKnowledgeScan = null;
    this.nextStateId = 1;

    // Clean up experience tracker if it has cleanup method
    if (this.experienceTracker && typeof this.experienceTracker.cleanup === 'function') {
      this.experienceTracker.cleanup();
    }

    debugLog('StateManager cleanup completed');
  }
}

function normalizeUrl(url: string): string {
  return url.replace(/^\/+|\/+$/g, '');
}
