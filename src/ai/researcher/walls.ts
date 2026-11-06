import type { ActionResult } from '../../action-result.ts';
import type Explorer from '../../explorer.ts';
import { pageEvidence } from '../judge.ts';
import type { Provider } from '../provider.ts';
import type { Constructor } from './mixin.ts';

const WALL_STATEMENT = "The open overlay is unrelated to the application's features, such as cookie consent, a paywall, marketing or an announcement. A sign-in form is not such an overlay.";

export function WithWalls<T extends Constructor>(Base: T) {
  return class extends Base {
    declare explorer: Explorer;
    declare provider: Provider;
    declare actionResult: ActionResult | undefined;

    async closeWall(screenshot: boolean): Promise<void> {
      const page = this.actionResult!;
      const isWall = await this.provider.oracle(WALL_STATEMENT, pageEvidence(page), { agentName: 'researcher', screenshot: page.screenshot });
      if (!isWall) return;

      await (this as any).cancelInUi();
      this.actionResult = await this.explorer.capture({ screenshot: screenshot && this.provider.hasVision() });
    }
  };
}

export interface WallMethods {
  closeWall(screenshot: boolean): Promise<void>;
}
