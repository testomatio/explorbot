import { render } from 'ink';
import React from 'react';
import AddKnowledge from '../components/AddKnowledge.js';
import { ConfigParser } from '../config.js';

export interface AddKnowledgeOptions {
  path?: string;
}

export async function addKnowledgeCommand(options: AddKnowledgeOptions = {}): Promise<void> {
  try {
    await ConfigParser.getInstance().loadConfig({ path: options.path || process.cwd() });

    render(React.createElement(AddKnowledge), {
      exitOnCtrlC: false,
      patchConsole: false,
    });
  } catch (error) {
    console.error('❌ Failed to start add-knowledge:', error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}
