import { isDebugMode, setDebugMode, tag } from '../utils/logger.js';
import { BaseCommand } from './base-command.js';

export class DebugCommand extends BaseCommand {
  name = 'debug';
  description = 'Toggle debug output';

  async execute(_args: string): Promise<void> {
    const enabled = !isDebugMode();
    setDebugMode(enabled);
    tag('info').log(`Debug mode ${enabled ? 'enabled' : 'disabled'}`);
  }
}
