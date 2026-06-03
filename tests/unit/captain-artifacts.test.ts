import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import { Captain } from '../../src/ai/captain.ts';
import { ConfigParser } from '../../src/config.ts';
import type { Task } from '../../src/test-plan.ts';

function buildCaptain(commandExecutor?: (cmd: string) => Promise<void>) {
  return Object.assign(Object.create(Captain.prototype), {
    commandExecutor,
    commandDescriptions: [],
  }) as Captain;
}

function task(description: string) {
  return { description } as Task;
}

describe('Captain artifact analysis tools', () => {
  it('reads explicit report artifact paths without shell commands', async () => {
    ConfigParser.resetForTesting();
    ConfigParser.setupTestConfig();
    const parser = ConfigParser.getInstance();
    const outputDir = join(dirname(parser.getConfigPath()!), 'output');
    const reportDir = join(outputDir, 'reports');
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(join(reportDir, 'session-demo-tests.md'), '# Failed run\n\nExpected button was missing.');

    const captain = buildCaptain();
    const tools = await (captain as any).idleModeTools({ explorBot: {}, task: task('analyze report') });
    const result = await tools.readArtifact.execute({ path: 'output/reports/session-demo-tests.md' });

    expect(result.success).toBe(true);
    expect(result.content).toContain('Expected button was missing');

    rmSync(join(outputDir, '..'), { recursive: true, force: true });
  });

  it('accepts paths prefixed with the project directory name', async () => {
    ConfigParser.resetForTesting();
    ConfigParser.setupTestConfig();
    const parser = ConfigParser.getInstance();
    const outputDir = join(dirname(parser.getConfigPath()!), 'output');
    const reportDir = join(outputDir, 'reports');
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(join(reportDir, 'session-demo-tests.md'), '# Failed run\n\nWrong expectation.');

    const captain = buildCaptain();
    const tools = await (captain as any).idleModeTools({ explorBot: {}, task: task('analyze report') });
    const projectName = basename(dirname(parser.getConfigPath()!));
    const result = await tools.readArtifact.execute({ path: `${projectName}/output/reports/session-demo-tests.md` });

    expect(result.success).toBe(true);
    expect(result.content).toContain('Wrong expectation');

    rmSync(join(outputDir, '..'), { recursive: true, force: true });
  });
});

describe('Captain command guard', () => {
  it('blocks test execution commands for natural-language analysis requests', async () => {
    let called = false;
    const captain = buildCaptain(async () => {
      called = true;
    });
    const tools = (captain as any).coreTools(task('analyze the latest report'), () => {});
    const result = await tools.runCommand.execute({ command: '/test failing_demo_for_captain_tui_explanation' });

    expect(result.success).toBe(false);
    expect(called).toBe(false);
    expect(result.message).toContain('Command blocked');
  });

  it('allows execution commands when the user explicitly typed that slash command', async () => {
    let called = false;
    const captain = buildCaptain(async () => {
      called = true;
    });
    const tools = (captain as any).coreTools(task('/test 1'), () => {});
    const result = await tools.runCommand.execute({ command: '/test 1' });

    expect(result.success).toBe(true);
    expect(called).toBe(true);
  });
});
