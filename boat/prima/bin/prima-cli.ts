#!/usr/bin/env bun
import { createPrimaCommands } from '../src/cli.ts';

const program = createPrimaCommands('prima');
program.parse();
