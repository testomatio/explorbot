import type { RequestStore } from '../api/request-store.ts';
import type { ExplorbotConfig } from '../config.ts';
import type Explorer from '../explorer.ts';
import type { KnowledgeTracker } from '../knowledge-tracker.ts';
import type { PlaywrightRecorder } from '../playwright-recorder.ts';
import type { StateManager } from '../state-manager.ts';
import type { AIProvider } from './provider.ts';

export interface Agent {
  emoji?: string;
}

export interface AgentDeps {
  explorer: Explorer;
  ai: AIProvider;
  config: ExplorbotConfig;
  stateManager: StateManager;
  knowledgeTracker: KnowledgeTracker;
  requestStore: RequestStore;
  playwrightRecorder: PlaywrightRecorder;
}

export type ToolDeps = Pick<AgentDeps, 'explorer' | 'stateManager' | 'ai'>;
