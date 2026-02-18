import { BaseCommand } from './base-command.js';

export class ResearchCommand extends BaseCommand {
  name = 'research';
  description = 'Research current page or navigate to URI and research. Use --deep to explore interactive elements by clicking them. Use --data to include page data.';
  suggestions = ['/research --deep - explore by clicking buttons', '/navigate <page> - to go to another page', '/plan <feature> - to plan testing'];

  async execute(args: string): Promise<void> {
    const includeData = args.includes('--data');
    const enableDeep = args.includes('--deep');
    const noFix = args.includes('--no-fix');
    const target = args.replace('--data', '').replace('--deep', '').replace('--no-fix', '').trim();

    if (target) {
      await this.explorBot.agentNavigator().visit(target);
    }

    const state = this.explorBot.getExplorer().getStateManager().getCurrentState();
    if (!state) {
      throw new Error('No active page to research');
    }

    await this.explorBot.agentResearcher().research(state, {
      screenshot: true,
      force: true,
      data: includeData,
      deep: enableDeep,
      fix: !noFix,
    });
  }
}
