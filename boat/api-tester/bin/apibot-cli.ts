#!/usr/bin/env bun
import { knowledgeOption, wsOption } from '../../../src/commands/options/index.ts';
import { createApiCommands } from '../src/cli.ts';

const program = createApiCommands('apibot');
wsOption.register(program);
knowledgeOption.register(program);
program.parse();
