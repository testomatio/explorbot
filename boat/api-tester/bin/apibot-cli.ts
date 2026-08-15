#!/usr/bin/env bun
import { remote } from '../../../src/remote.ts';
import { createApiCommands } from '../src/cli.ts';

const program = createApiCommands('apibot');
remote.registerOption(program);
program.parse();
