import { BaseCommand } from './base-command.js';

export class ResearchCommand extends BaseCommand {
  name = 'research';
  description = 'Research current page or navigate to URI and research';

  async execute(args: string): Promise<void> {
    const includeData = args.includes('--data');
    const includeDeep = args.includes('--deep');
    const target = args.replace('--data', '').replace('--deep', '').trim();

    if (target) {
      await this.explorBot.getExplorer().visit(target);
    }

    const state = this.explorBot.getExplorer().getStateManager().getCurrentState();
    if (!state) {
      throw new Error('No active page to research');
    }

    await this.explorBot.agentResearcher().research(state, {
      screenshot: true,
      force: true,
      data: includeData,
      deep: includeDeep,
    });
  }
}
