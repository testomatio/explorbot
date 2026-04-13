import * as codeceptjs from 'codeceptjs';
import { ConfigParser } from '../config.ts';
import { dryRunTestFile, loadTestSuites, printTestList } from '../utils/test-files.ts';
import { BaseCommand } from './base-command.js';

export class RunsCommand extends BaseCommand {
  name = 'runs';
  description = 'List generated test files and their scenarios';
  tuiEnabled = true;

  async execute(args: string): Promise<void> {
    if (!this.explorBot.isExploring) {
      codeceptjs.container.create({ helpers: {} }, {});
    }

    const { args: remaining } = this.parseArgs(args);
    const filePath = remaining[0];

    if (filePath) {
      await dryRunTestFile(filePath);
      return;
    }

    const suites = loadTestSuites(ConfigParser.getInstance().getTestsDir());
    printTestList(suites);
  }
}
