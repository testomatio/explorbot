import { tag } from '../utils/logger.js';
import { BaseCommand } from './base-command.js';

export class ExploreCommand extends BaseCommand {
  name = 'explore';
  description = 'Start web exploration';

  async execute(args: string): Promise<void> {
    await this.explorBot.explore(args.trim() || undefined);
    tag('info').log('Navigate to other page with /navigate or /explore again to continue exploration');
  }
}
