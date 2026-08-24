#!/usr/bin/env bun
import { registerKnowledgeOption } from '../../../src/knowledge-tracker.ts';
import { remote } from '../../../src/remote.ts';
import { createDocsCommands } from '../src/cli.ts';

const program = createDocsCommands('doc-collector');
remote.registerOption(program);
registerKnowledgeOption(program);
program.parse();
