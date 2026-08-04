import { readFileSync, writeFileSync } from 'node:fs';
import type { ExplorbotConfig } from '../config.ts';
import type { ExperienceTracker } from '../experience-tracker.ts';
import type Explorer from '../explorer.ts';
import type { PlaywrightRecorder } from '../playwright-recorder.ts';
import type { Reporter } from '../reporter.ts';
import type { StateManager } from '../state-manager.ts';
import type { Plan } from '../test-plan.ts';
import { tag } from '../utils/logger.ts';
import { relativeToCwd } from '../utils/next-steps.ts';
import { type CodeceptJSMethods, WithCodeceptJS } from './historian/codeceptjs.ts';
import { type ExperienceMethods, WithExperience } from './historian/experience.ts';
import { type PlaywrightMethods, WithPlaywright } from './historian/playwright.ts';
import { type ScreencastMethods, WithScreencast } from './historian/screencast.ts';
import type { Provider } from './provider.ts';

const HistorianBase = WithScreencast(WithPlaywright(WithCodeceptJS(WithExperience(Object as unknown as new (...args: any[]) => object))));

export interface Historian extends ExperienceMethods, CodeceptJSMethods, PlaywrightMethods, ScreencastMethods {}

export class Historian extends HistorianBase {
  declare provider: Provider;
  declare experienceTracker: ExperienceTracker;
  declare reporter: Reporter | undefined;
  declare stateManager: StateManager | undefined;
  declare config: ExplorbotConfig | undefined;
  declare playwright: { recorder: PlaywrightRecorder; explorer: Explorer } | undefined;
  declare savedFiles: Set<string>;

  constructor(provider: Provider, experienceTracker: ExperienceTracker, reporter?: Reporter, stateManager?: StateManager, config?: ExplorbotConfig, playwright?: { recorder: PlaywrightRecorder; explorer: Explorer }) {
    super();
    this.provider = provider;
    this.experienceTracker = experienceTracker;
    this.reporter = reporter;
    this.stateManager = stateManager;
    this.config = config;
    this.playwright = playwright;
    this.savedFiles = new Set();
    this.attachScreencast();
  }

  isPlaywrightFramework(): boolean {
    return this.config?.ai?.agents?.historian?.framework === 'playwright';
  }

  getSavedFiles(): string[] {
    return [...this.savedFiles];
  }

  savePlanToFile(plan: Plan): string {
    return this.isPlaywrightFramework() ? this.savePlaywrightPlanToFile(plan) : this.saveCodeceptPlanToFile(plan);
  }

  rewriteScenarioInFile(filePath: string, healedSteps: Array<{ original: string; healed: string }>): void {
    let content = readFileSync(filePath, 'utf-8');

    for (const step of healedSteps) {
      content = content.replace(step.original, step.healed);
    }

    writeFileSync(filePath, content);
    this.savedFiles.add(filePath);
    tag('operation').log(`Updated test file with healed steps: ${relativeToCwd(filePath)}`);
  }
}
