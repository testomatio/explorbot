import { BaseCommand } from './base-command.js';

export class DrillCommand extends BaseCommand {
  name = 'drill';
  description = 'Drill all components on current page to learn interactions';
  aliases = ['bosun'];
  suggestions = ['/research - to see UI map first', '/navigate <page> - to go to another page'];

  async execute(args: string): Promise<void> {
    const knowledgePath = this.parseKnowledgeArg(args);
    const maxComponents = this.parseMaxArg(args);

    const state = this.explorBot.getExplorer().getStateManager().getCurrentState();
    if (!state) {
      throw new Error('No active page to drill');
    }

    await this.explorBot.agentBosun().drill({
      knowledgePath,
      maxComponents,
      interactive: true,
    });
  }

  private parseKnowledgeArg(args: string): string | undefined {
    const match = args.match(/--knowledge\s+(\S+)/);
    return match ? match[1] : undefined;
  }

  private parseMaxArg(args: string): number | undefined {
    const match = args.match(/--max\s+(\d+)/);
    return match ? Number.parseInt(match[1], 10) : undefined;
  }
}
