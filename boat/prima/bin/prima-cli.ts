#!/usr/bin/env bun
import { authOption, decisionModelOption, knowledgeOption } from '../../../src/commands/options/index.ts';
import { createPrimaCommands } from '../src/cli.ts';
import { PrimaHelp } from '../src/help.ts';

const program = createPrimaCommands(new PrimaHelp().name);
knowledgeOption.register(program);
authOption.register(program);
decisionModelOption.register(program);
program.parse();
