import { join } from 'node:path';
import { ConfigParser } from '../config.ts';
import { tag } from '../utils/logger.ts';
import { BaseCommand } from './base-command.js';

export class ResearchCommand extends BaseCommand {
  name = 'research';
  description = 'Research current page or navigate to URI and research. Use --deep to explore interactive elements by clicking them. Use --data to include page data.';
  suggestions = ['/navigate <page> - to go to another page', '/plan <feature> - to plan testing'];

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

    const result = await this.explorBot.agentResearcher().research(state, {
      screenshot: true,
      force: true,
      data: includeData,
      deep: enableDeep,
      fix: !noFix,
    });

    tag('multiline').log(result);

    if (state.hash) {
      const outputDir = ConfigParser.getInstance().getOutputDir();
      tag('info').log(`Research file: ${join(outputDir, 'research', `${state.hash}.md`)}`);
    }

    if (!enableDeep) {
      this.suggestions = ['/research <page> --deep - analyze page for all expandable elements and interactions'];
    }
  }
}
