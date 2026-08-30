#!/usr/bin/env bun
import { registerKnowledgeOption } from '../../../src/config.ts';
import { remote } from '../../../src/remote.ts';
import { createApiCommands } from '../src/cli.ts';

const program = createApiCommands('apibot');
remote.registerOption(program);
registerKnowledgeOption(program);
program.parse();
