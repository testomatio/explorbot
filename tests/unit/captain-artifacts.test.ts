import { describe, expect, it } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { Captain } from '../../src/ai/captain.ts';
import { readCaptainFile } from '../../src/ai/captain/file-tools.ts';
import { ConfigParser } from '../../src/config.ts';
import type { Task } from '../../src/test-plan.ts';

function buildCaptain(commandExecutor?: (cmd: string) => Promise<void>) {
  return Object.assign(Object.create(Captain.prototype), {
    commandExecutor,
    commandDescriptions: [],
  }) as Captain;
}

function task(description: string, notes: string[] = []) {
  return {
    description,
    addNote: (note: string) => notes.push(note),
  } as unknown as Task;
}

describe('Captain artifact analysis tools', () => {
  it('keeps done details as the user-facing answer', async () => {
    const notes: string[] = [];
    const captain = buildCaptain();
    const tools = (captain as any).coreTools(task('show config', notes), () => {});

    const result = await tools.done.execute({ summary: 'Displayed config details', details: 'baseUrl: https://example.test\nbrowser: chromium' });

    expect(result.success).toBe(true);
    expect(notes).toEqual(['baseUrl: https://example.test\nbrowser: chromium', 'Displayed config details']);
  });

  it('rejects informational requests completed without details', async () => {
    const captain = buildCaptain();
    const tools = (captain as any).coreTools(task('explain what page I am on'), () => {});

    const result = await tools.done.execute({ summary: 'Explained current page' });

    expect(result.success).toBe(false);
    expect(result.message).toContain('actual answer in details');
  });

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
    const result = await tools.readFile.execute({ path: 'output/reports/session-demo-tests.md' });

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
    const result = await tools.readFile.execute({ path: `${projectName}/output/reports/session-demo-tests.md` });

    expect(result.success).toBe(true);
    expect(result.content).toContain('Wrong expectation');

    rmSync(join(outputDir, '..'), { recursive: true, force: true });
  });

  it('reads a requested line range from file contents', async () => {
    ConfigParser.resetForTesting();
    ConfigParser.setupTestConfig();
    const parser = ConfigParser.getInstance();
    const outputDir = join(dirname(parser.getConfigPath()!), 'output');
    const reportDir = join(outputDir, 'reports');
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(join(reportDir, 'session-demo-tests.md'), ['line 1', 'line 2', 'line 3', 'line 4'].join('\n'));

    const captain = buildCaptain();
    const tools = await (captain as any).idleModeTools({ explorBot: {}, task: task('analyze report') });
    const result = await tools.readFile.execute({ path: 'output/reports/session-demo-tests.md', startLine: 2, endLine: 3 });

    expect(result.success).toBe(true);
    expect(result.content).toBe('line 2\nline 3');

    rmSync(join(outputDir, '..'), { recursive: true, force: true });
  });

  it('reads line ranges from the end of file', async () => {
    ConfigParser.resetForTesting();
    ConfigParser.setupTestConfig();
    const parser = ConfigParser.getInstance();
    const outputDir = join(dirname(parser.getConfigPath()!), 'output');
    const reportDir = join(outputDir, 'reports');
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(join(reportDir, 'session-demo-tests.md'), ['line 1', 'line 2', 'line 3', 'line 4'].join('\n'));

    const captain = buildCaptain();
    const tools = await (captain as any).idleModeTools({ explorBot: {}, task: task('analyze report') });
    const result = await tools.readFile.execute({ path: 'output/reports/session-demo-tests.md', startLine: -2 });

    expect(result.success).toBe(true);
    expect(result.content).toBe('line 3\nline 4');

    rmSync(join(outputDir, '..'), { recursive: true, force: true });
  });

  it('uses caller-provided readable directories', () => {
    ConfigParser.resetForTesting();
    ConfigParser.setupTestConfig();
    const parser = ConfigParser.getInstance();
    const projectRoot = dirname(parser.getConfigPath()!);
    const customDir = join(projectRoot, 'custom-knowledge');
    mkdirSync(customDir, { recursive: true });
    writeFileSync(join(customDir, 'hint.md'), 'custom directory content');

    const result = readCaptainFile(projectRoot, { path: 'custom-knowledge/hint.md' }, ['custom-knowledge']);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.content).toContain('custom directory content');
    }

    rmSync(projectRoot, { recursive: true, force: true });
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
