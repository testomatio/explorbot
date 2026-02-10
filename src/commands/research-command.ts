import { BaseCommand } from './base-command.js';

export class ResearchCommand extends BaseCommand {
  name = 'research';
  description = 'Research current page or navigate to URI and research. Use --verify to audit research coverage.';
  suggestions = ['/research --verify - audit element coverage', '/navigate <page> - to go to another page', '/plan <feature> - to plan testing'];

  async execute(args: string): Promise<void> {
    const includeData = args.includes('--data');
    const enableVerify = args.includes('--verify');
    const target = args.replace('--data', '').replace('--verify', '').trim();

    if (target) {
      await this.explorBot.getExplorer().visit(target);
    }

    const state = this.explorBot.getExplorer().getStateManager().getCurrentState();
    if (!state) {
      throw new Error('No active page to research');
    }

    const researchResult = await this.explorBot.agentResearcher().research(state, {
      screenshot: true,
      force: true,
      data: includeData,
    });

    if (enableVerify) {
      const report = this.explorBot.agentResearcher().auditResearch(state, researchResult);
      const { tag } = await import('../utils/logger.js');
      tag('multiline').log(report);
    }
  }
}
