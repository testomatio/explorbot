import { tag } from '../utils/logger.js';
import { BaseCommand } from './base-command.js';

export class NavigateCommand extends BaseCommand {
  name = 'navigate';
  description = 'Navigate to URI or state using AI';

  async execute(args: string): Promise<void> {
    const destination = args.trim();
    if (!destination) {
      throw new Error('Navigate command requires a target URI or state');
    }

    await this.explorBot.agentNavigator().visit(destination);
    tag('success').log(`Navigation requested: ${destination}`);
  }
}
