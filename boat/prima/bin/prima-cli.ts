#!/usr/bin/env bun
import { registerKnowledgeOption } from '../../../src/config.ts';
import { createPrimaCommands } from '../src/cli.ts';

const program = createPrimaCommands('prima');
registerKnowledgeOption(program);
program.parse();
