#!/usr/bin/env bun
import { decisionModelOption, knowledgeOption } from '../../../src/commands/options/index.ts';
import { createPrimaCommands } from '../src/cli.ts';

const program = createPrimaCommands('prima');
knowledgeOption.register(program);
decisionModelOption.register(program);
program.parse();
