#!/usr/bin/env bun
import { authOption, knowledgeOption, wsOption } from '../../../src/commands/options/index.ts';
import { createApiCommands } from '../src/cli.ts';

const program = createApiCommands('apibot');
wsOption.register(program);
knowledgeOption.register(program);
authOption.register(program);
program.parse();
