#!/usr/bin/env bun
import { createDocsCommands } from '../src/cli.ts';

const program = createDocsCommands('doc-collector');
program.parse();
