#!/usr/bin/env bun
import { createApiCommands } from '../src/cli.ts';

const program = createApiCommands('apibot');
program.parse();
