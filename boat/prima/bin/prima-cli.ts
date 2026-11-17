#!/usr/bin/env bun
import { authOption, decisionModelOption, knowledgeOption } from '../../../src/commands/options/index.ts';
import { createPrimaCommands, version } from '../src/cli.ts';

const program = createPrimaCommands('prima');
knowledgeOption.register(program);
authOption.register(program);
decisionModelOption.register(program);
if (process.argv.length === 2) console.log(`prima ${version}`);
program.parse();
