import { ActionResult } from './action-result.js';
import type { ExperienceTracker } from './experience-tracker.js';
import type { KnowledgeTracker, Knowledge } from './knowledge-tracker.js';
import { detectFocusArea } from './utils/aria.js';
import { createDebug } from './utils/logger.js';
import { extractStatePath } from './utils/url-matcher.js';

const debugLog = createDebug('explorbot:state');

export interface Link {
  title: string;
  url: string;
  visible?: boolean;
}

export interface WebPageState {
  /** Unique incremental state identifier */
  id?: number;
  /** URL path without domain, including hash: /path/to/page#section */
  url: string;
  /** Page title */
  title?: string;
  /** HTTP status of the main document navigation */
  httpStatus?: number;
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
  links?: Link[];
  verifications?: Record<string, boolean>;
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

export type { Knowledge };

export class StateManager {
  private currentState: WebPageState | null = null;
  private stateHistory: StateTransition[] = [];
  private allVisitedUrls: Set<string> = new Set();
  private stateChangeListeners: StateChangeListener[] = [];
  private experienceTracker!: ExperienceTracker;
  private knowledgeTracker: KnowledgeTracker;
  private nextStateId = 1;

  constructor(experienceTracker: ExperienceTracker, knowledgeTracker: KnowledgeTracker) {
    this.experienceTracker = experienceTracker;
    this.knowledgeTracker = knowledgeTracker;
  }

  getExperienceTracker(): ExperienceTracker {
    return this.experienceTracker;
  }

  getKnowledgeTracker(): KnowledgeTracker {
    return this.knowledgeTracker;
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
   * Update current state from ActionResult and record transition if state changed
   */
  updateState(actionResult: ActionResult, codeBlock?: string, trigger: 'manual' | 'navigation' | 'automatic' = 'manual'): WebPageState {
    const previousState = this.currentState;
    const previousHash = previousState?.hash;

    const newState = actionResult;
    this.currentState = newState;
    this.currentState.id = this.nextStateId++;
    if (newState.url) this.allVisitedUrls.add(normalizeUrl(newState.url));

    const hashChanged = actionResult.hash !== previousHash;
    const dialogOpened = !hashChanged && this.hasDialogAppeared(previousState, newState);

    if (hashChanged || dialogOpened) {
      const transition: StateTransition = {
        fromState: previousState,
        toState: newState,
        codeBlock: codeBlock || '',
        timestamp: new Date(),
        trigger,
      };
      this.stateHistory.push(transition);
      this.emitStateChange(transition);

      if (dialogOpened) {
        debugLog('State change detected: modal dialog appeared');
      }
    }

    debugLog(`State updated: ${this.currentState.url} (${this.currentState.hash})`);

    return newState;
  }

  /**
   * Update state from basic data (for navigation events)
   */
  updateStateFromBasic(url: string, title?: string, trigger: 'manual' | 'navigation' | 'automatic' = 'navigation'): WebPageState {
    const path = extractStatePath(url) || '/';

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
    this.allVisitedUrls.add(normalizeUrl(newState.url));

    this.emitStateChange(transition);

    debugLog(`State updated from navigation: ${this.currentState.url} (${this.currentState.hash})`);

    return newState;
  }

  private hasDialogAppeared(previousState: WebPageState | null, newState: WebPageState): boolean {
    const prevFocus = detectFocusArea(previousState?.ariaSnapshot ?? null);
    const newFocus = detectFocusArea(newState.ariaSnapshot ?? null);
    return !prevFocus.detected && newFocus.detected;
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
    const minWindow = 6;
    const increment = 2;
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
   * Get relevant knowledge files for current state
   */
  getRelevantKnowledge(): Knowledge[] {
    if (!this.currentState) return [];

    const actionResult = ActionResult.fromState(this.currentState);
    return this.knowledgeTracker.getRelevantKnowledge(actionResult);
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
  /**
   * Check if we've been in this state before
   */
  hasVisitedState(path: string): boolean {
    return this.allVisitedUrls.has(normalizeUrl(path));
  }

  getAllVisitedUrls(): Set<string> {
    return this.allVisitedUrls;
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
  /**
   * Clear state history (useful for testing or reset)
   * Note: This preserves the current state, only clears navigation history
   */
  clearHistory(): void {
    this.stateHistory = [];
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
    this.allVisitedUrls.clear();
    this.stateChangeListeners = [];
    this.nextStateId = 1;

    // Clean up experience tracker if it has cleanup method
    if (this.experienceTracker && typeof this.experienceTracker.cleanup === 'function') {
      this.experienceTracker.cleanup();
    }

    debugLog('StateManager cleanup completed');
  }
}

export function normalizeUrl(url: string): string {
  if (url.startsWith('/')) {
    return url.replace(/^\/+/, '').replace(/\/+$/g, '');
  }

  try {
    const parsed = new URL(url, 'http://localhost');
    const path = parsed.pathname.replace(/^\/+|\/+$/g, '');
    return `${path}${parsed.search}${parsed.hash}`;
  } catch {
    return url.replace(/^\/+|\/+$/g, '');
  }
}
