#!/usr/bin/env bun
import { knowledgeOption, wsOption } from '../../../src/commands/options/index.ts';
import { createDocsCommands } from '../src/cli.ts';

const program = createDocsCommands('doc-collector');
wsOption.register(program);
knowledgeOption.register(program);
program.parse();
