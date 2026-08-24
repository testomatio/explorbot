#!/usr/bin/env bun
import { registerKnowledgeOption } from '../../../src/knowledge-tracker.ts';
import { remote } from '../../../src/remote.ts';
import { createApiCommands } from '../src/cli.ts';

const program = createApiCommands('apibot');
remote.registerOption(program);
registerKnowledgeOption(program);
program.parse();
