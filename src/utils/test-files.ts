import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { highlight } from 'cli-highlight';
import * as codeceptjs from 'codeceptjs';
import stepsListener from 'codeceptjs/lib/listener/steps';
import storeListener from 'codeceptjs/lib/listener/store';
import store from 'codeceptjs/lib/store';
import figureSet from 'figures';
import { ConfigParser } from '../config.ts';

export function loadTestSuites(testsDir: string): any[] {
  if (!existsSync(testsDir)) return [];

  const jsFiles = readdirSync(testsDir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => path.resolve(testsDir, f));

  if (jsFiles.length === 0) return [];

  codeceptjs.container.createMocha();
  const mocha = codeceptjs.container.mocha();
  mocha.files = jsFiles;
  mocha.loadFiles();

  return mocha.suite.suites || [];
}

export function printTestList(suites: any[]): void {
  if (suites.length === 0) {
    console.log(chalk.yellow('No test files found. Run /explore first.'));
    return;
  }

  let totalActive = 0;
  let totalSkipped = 0;
  let index = 0;

  for (const suite of suites) {
    const file = path.relative(process.cwd(), suite.file || '');
    const active = suite.tests.filter((t: any) => !t.pending).length;
    const skipped = suite.tests.filter((t: any) => t.pending).length;
    totalActive += active;
    totalSkipped += skipped;

    console.log(`\n${chalk.bold.cyan(suite.title)}`);
    console.log(chalk.gray(file));

    for (const test of suite.tests) {
      const idx = chalk.dim(`${++index}.`);
      if (test.pending) {
        console.log(chalk.gray(`  ${idx} ${figureSet.line} ${test.title} (skipped)`));
      } else {
        console.log(`  ${idx} ${chalk.green(figureSet.pointer)} ${test.title}`);
      }
    }
  }

  console.log(`\n${chalk.bold(`${totalActive + totalSkipped}`)} scenarios (${chalk.green(`${totalActive} active`)}, ${chalk.gray(`${totalSkipped} skipped`)})`);
}

export async function dryRunTestFile(filePath: string): Promise<void> {
  const absPath = path.resolve(filePath);
  if (!existsSync(absPath)) {
    console.log(chalk.yellow(`File not found: ${absPath}`));
    return;
  }

  const config = ConfigParser.getInstance().getConfig();
  const configPath = ConfigParser.getInstance().getConfigPath();
  const projectRoot = configPath ? path.dirname(configPath) : process.cwd();

  const codeceptConfig = {
    helpers: {
      Playwright: { browser: config.playwright.browser, url: config.playwright.url },
    },
  };

  (global as any).output_dir = path.join(projectRoot, 'output', 'states');
  (global as any).codecept_dir = projectRoot;

  codeceptjs.container.create(codeceptConfig, {});
  await codeceptjs.recorder.start();
  await codeceptjs.container.started(null);

  store.dryRun = true;
  (global as any).container = codeceptjs.container;
  storeListener();
  stepsListener();

  codeceptjs.container.createMocha();
  const mocha = codeceptjs.container.mocha();
  mocha.reporter(class {});
  mocha.files = [absPath];
  mocha.loadFiles();

  let currentSuite = '';

  codeceptjs.event.dispatcher.on('suite.before', (suite: any) => {
    if (suite.title && suite.title !== currentSuite) {
      currentSuite = suite.title;
      console.log(`\n${chalk.bold.cyan(suite.title)}`);
      console.log(chalk.gray(path.relative(process.cwd(), suite.file || absPath)));
    }
  });

  codeceptjs.event.dispatcher.on('test.before', (t: any) => {
    console.log(`\n  ${chalk.green(figureSet.pointer)} ${chalk.bold(t.title)}`);
  });

  codeceptjs.event.dispatcher.on('step.start', (step: any) => {
    const code = highlight(step.toCode(), { language: 'javascript' });
    console.log(chalk.dim(`    ${code}`));
  });

  await new Promise<void>((resolve) => {
    const runner = mocha.run(() => resolve());
    runner.on('pending', (t: any) => {
      console.log(chalk.gray(`  ${figureSet.line} ${t.title} (skipped)`));
    });
  });
}
