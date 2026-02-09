import { tag } from '../utils/logger.js';
import { BaseCommand } from './base-command.js';

export class ExploreCommand extends BaseCommand {
  name = 'explore';
  description = 'Start web exploration';
  suggestions = ['/navigate <page> - to go to another page', '/research - to analyze', '/plan <feature> - to plan testing'];

  async execute(args: string): Promise<void> {
    await this.explorBot.explore(args.trim() || undefined);
  }
}
