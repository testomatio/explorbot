import { render } from 'ink';
import React from 'react';
import AddKnowledge from '../components/AddKnowledge.js';
import { ConfigParser } from '../config.js';

export interface AddKnowledgeOptions {
  path?: string;
}

export async function addKnowledgeCommand(options: AddKnowledgeOptions = {}): Promise<void> {
  const customPath = options.path;

  try {
    const configParser = ConfigParser.getInstance();
    const configPath = configParser.getConfigPath();

    if (!configPath) {
      console.error('❌ No explorbot configuration found. Please run "maclay init" first.');
      process.exit(1);
    }

    render(
      React.createElement(AddKnowledge, {
        customPath,
      }),
      {
        exitOnCtrlC: false,
        patchConsole: false,
      }
    );
  } catch (error) {
    console.error('❌ Failed to start add-knowledge:', error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}
