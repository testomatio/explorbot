#!/usr/bin/env bun
import { remote } from '../../../src/remote.ts';
import { createDocsCommands } from '../src/cli.ts';

const program = createDocsCommands('doc-collector');
remote.registerOption(program);
program.parse();
