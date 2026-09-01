import type { Command } from 'commander';
import { remote } from '../../remote.js';
import { BaseOption } from './base-option.js';

export class WsOption extends BaseOption {
  flags = '--ws <url>';
  description = 'Stream this run to a remote UI over WebSocket';

  protected apply(options: Record<string, any>, command: Command): void {
    const url = options.ws || process.env.EXPLORBOT_WS_URL;
    if (!url) return;
    remote.attach(String(url), commandPath(command));
  }
}

function commandPath(command: Command): string {
  const parts: string[] = [];
  let node: Command | null = command;
  while (node) {
    parts.unshift(node.name());
    node = node.parent;
  }
  return parts.slice(1).join(' ') || parts.join(' ');
}
