import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
// @ts-ignore
import * as codeceptjs from 'codeceptjs';
import { outputPath } from '../../config.ts';
import type { ExplorbotConfig } from '../../config.ts';
import type Explorer from '../../explorer.ts';
import type { PlaywrightRecorder } from '../../playwright-recorder.ts';
import { tag } from '../../utils/logger.ts';
import { relativeToCwd } from '../../utils/next-steps.ts';
import { safeFilename } from '../../utils/strings.ts';
import { type Constructor, debugLog } from './mixin.ts';

const FATAL_SCREENCAST_STOP_ERRORS = /Target page, context or browser has been closed|Target closed|Session closed|Protocol error/i;

export interface ScreencastMethods {
  attachScreencast(): void;
  isScreencastActive(): boolean;
  stopScreencast(): Promise<void>;
}

export function WithScreencast<T extends Constructor>(Base: T) {
  return class extends Base {
    declare config: ExplorbotConfig | undefined;
    declare savedFiles: Set<string>;
    declare playwright: { recorder: PlaywrightRecorder; explorer: Explorer } | undefined;

    private screencastPage: any = null;
    private screencastActive = false;
    private screencastPath: string | null = null;
    private screencastListenersInstalled = false;
    private screencastTask: any = null;
    private screencastLastChapter: string | null = null;
    private onTestBefore?: (test: any) => void;
    private onStepPassed?: (step: any) => void;
    private onTestAfter?: () => void;

    isScreencastActive(): boolean {
      return this.screencastActive;
    }

    attachScreencast(): void {
      if (this.screencastListenersInstalled) return;
      if (!this.config?.ai?.agents?.historian?.screencast) return;
      if (!this.playwright?.explorer) return;

      this.onTestBefore = (test: any) => {
        void this.startScreencast(test);
      };
      this.onStepPassed = (step: any) => {
        void this.emitChapter(step);
      };
      this.onTestAfter = () => {
        void this.stopScreencast();
      };

      codeceptjs.event.dispatcher.on('test.before', this.onTestBefore);
      codeceptjs.event.dispatcher.on('step.passed', this.onStepPassed);
      codeceptjs.event.dispatcher.on('test.after', this.onTestAfter);

      this.screencastListenersInstalled = true;
    }

    private async startScreencast(test: any): Promise<void> {
      if (this.screencastActive) return;
      const page = this.playwright?.explorer?.page;
      if (!page?.screencast?.start) return;

      const task = test?._explorbotTest;
      const scenarioName = task?.scenario || test?.title || 'scenario';
      const planTitle: string | undefined = task?.plan?.title;
      const planTests: any[] | undefined = task?.plan?.tests;
      const index = planTests && task ? planTests.indexOf(task) + 1 : 0;

      const parts: string[] = [];
      if (planTitle) parts.push(safeFilename(planTitle));
      if (index > 0) parts.push(String(index));
      parts.push(safeFilename(scenarioName));

      const dir = outputPath('screencasts');
      mkdirSync(dir, { recursive: true });
      const filePath = join(dir, `${parts.join('-')}.webm`);

      const screencastConfig = this.config?.ai?.agents?.historian?.screencast;
      const screencastOpts = typeof screencastConfig === 'object' ? screencastConfig : {};
      const size = screencastOpts.size ?? page.viewportSize?.() ?? undefined;
      const quality = screencastOpts.quality ?? 95;

      try {
        await page.screencast.start({ path: filePath, quality, size });
        await page.screencast.showActions({ position: 'top-left' });
        this.screencastPage = page;
        this.screencastPath = filePath;
        this.screencastActive = true;
        this.screencastTask = test?._explorbotTest || null;
        this.screencastLastChapter = null;
      } catch (err) {
        tag('operation').log(`Screencast start failed: ${(err as Error).message}`);
      }
    }

    private async emitChapter(_step: any): Promise<void> {
      if (!this.screencastActive) return;
      const explanation = this.screencastTask?.activeNote?.getMessage?.();
      if (!explanation) return;
      if (explanation === this.screencastLastChapter) return;
      this.screencastLastChapter = explanation;
      try {
        await this.screencastPage.screencast.showChapter(explanation);
      } catch (err) {
        debugLog('screencast.showChapter failed:', err);
      }
    }

    async stopScreencast(): Promise<void> {
      if (!this.screencastActive) return;
      const path = this.screencastPath;
      const task = this.screencastTask;
      let stopped = false;
      try {
        await this.screencastPage.screencast.stop();
        stopped = true;
      } catch (err) {
        const message = (err as Error).message;
        if (FATAL_SCREENCAST_STOP_ERRORS.test(message)) {
          tag('operation').log('Screencast skipped: browser was closed before recording could be finalized');
        } else {
          tag('operation').log(`Screencast stop failed: ${message}`);
        }
      }
      this.screencastActive = false;
      this.screencastPage = null;
      this.screencastPath = null;
      this.screencastTask = null;
      this.screencastLastChapter = null;
      if (path && stopped) {
        this.savedFiles.add(path);
        task?.addArtifact?.(path);
        tag('operation').log(`Saved screencast: ${relativeToCwd(path)}`);
      }
    }
  };
}
