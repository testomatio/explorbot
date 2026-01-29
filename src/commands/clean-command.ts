import { tag } from '../utils/logger.js';
import { BaseCommand } from './base-command.js';

export class CleanCommand extends BaseCommand {
  name = 'clean';
  description = 'Clean captain conversation';

  async execute(_args: string): Promise<void> {
    this.explorBot.agentCaptain().cleanConversation();
    tag('success').log('Captain conversation cleaned');
  }
}
