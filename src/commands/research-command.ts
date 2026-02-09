import { BaseCommand } from './base-command.js';

export class ResearchCommand extends BaseCommand {
  name = 'research';
  description = 'Research current page or navigate to URI and research';
  suggestions = ['/navigate <page> - to go to another page', '/plan <feature> - to plan testing'];

  async execute(args: string): Promise<void> {
    const includeData = args.includes('--data');
    const target = args.replace('--data', '').trim();

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
    });
  }
}
