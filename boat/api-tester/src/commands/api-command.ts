import { BaseCommand } from '../../../../src/commands/base-command.ts';
import type { ApiBot } from '../apibot.ts';

export abstract class ApiCommand extends BaseCommand<ApiBot> {
  prefix = 'apibot';

  protected get bot(): ApiBot {
    return this.explorBot;
  }
}
