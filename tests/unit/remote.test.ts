import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ServerWebSocket } from 'bun';
import Action from '../../src/action.ts';
import { saveResearch } from '../../src/ai/researcher/cache.ts';
import { SessionAnalyst } from '../../src/ai/session-analyst.ts';
import { isInteractive } from '../../src/ai/task-agent.ts';
import { ConfigParser } from '../../src/config.ts';
import { executionController } from '../../src/execution-controller.ts';
import { remote } from '../../src/remote.ts';
import { StateManager } from '../../src/state-manager.ts';
import { Plan, Test, TestResult } from '../../src/test-plan.ts';
import { tag } from '../../src/utils/logger.ts';

let server: ReturnType<typeof Bun.serve> | null = null;
let received: any[] = [];
let clients: ServerWebSocket<unknown>[] = [];

function url(): string {
  return `ws://127.0.0.1:${server!.port}`;
}

async function waitFor<T>(read: () => T | undefined, timeout = 3000): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('timed out waiting for a frame');
}

const frameOf = (type: string) => () => received.find((f) => f.type === type);

beforeEach(() => {
  received = [];
  clients = [];
  server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(req, srv) {
      if (srv.upgrade(req)) return undefined as unknown as Response;
      return new Response('expected a websocket', { status: 400 });
    },
    websocket: {
      open(ws) {
        clients.push(ws);
      },
      message(_ws, message) {
        received.push(JSON.parse(String(message)));
      },
    },
  });
});

afterEach(async () => {
  await remote.close(0);
  executionController.reset();
  ConfigParser.cleanupAllTestDirectories();
  server?.stop(true);
  server = null;
});

describe('remote', () => {
  test('announces the run, and frames sent before the socket opens are flushed in order', async () => {
    remote.attach(url(), 'explore');
    remote.send('activity', { message: 'first' });
    remote.send('activity', { message: 'second' });

    await waitFor(() => (received.filter((f) => f.type === 'activity').length >= 2 ? true : undefined));

    expect(received[0]).toMatchObject({ type: 'hello', command: 'explore', pid: process.pid });
    expect(received[0].ts).toBeNumber();
    expect(received.filter((f) => f.type === 'activity').map((f) => f.message)).toEqual(['first', 'second']);
  });

  test('every log type reaches the UI as its own level, with the step error alongside', async () => {
    remote.attach(url(), 'test');
    await waitFor(frameOf('hello'));

    tag('info').log('exploring /login');
    tag('multiline').log('# Heading\n\nbody');
    tag('step').log({ toCode: () => 'I.click("Sign in")' }, new Error('element not found'));
    tag('html').log('<html><body>dropped</body></html>');

    await waitFor(() => (received.filter((f) => f.type === 'log').length >= 3 ? true : undefined));
    const logs = received.filter((f) => f.type === 'log');

    expect(logs.map((f) => f.level)).toEqual(['info', 'multiline', 'step']);
    expect(logs[0].content).toBe('exploring /login');
    expect(logs[2]).toMatchObject({ content: 'I.click("Sign in")', error: 'element not found' });
  });

  test('an ask goes through the execution controller and its answer comes back', async () => {
    remote.attach(url(), 'explore');
    const answer = executionController.requestInput('Which credentials should I use?');

    const ask = await waitFor(frameOf('ask'));
    expect(ask.prompt).toBe('Which credentials should I use?');
    clients[0].send(JSON.stringify({ type: 'answer', askId: ask.askId, value: 'admin/admin' }));

    expect(await answer).toBe('admin/admin');
  });

  test('a skipped ask resolves to null', async () => {
    remote.attach(url(), 'explore');
    const answer = executionController.requestInput('Anything to add?');
    const ask = await waitFor(frameOf('ask'));
    clients[0].send(JSON.stringify({ type: 'answer', askId: ask.askId, value: null }));
    expect(await answer).toBeNull();
  });

  test('an interrupt frame interrupts the run, and an unknown frame is ignored', async () => {
    remote.attach(url(), 'explore');
    await waitFor(frameOf('hello'));

    clients[0].send(JSON.stringify({ type: 'from-the-future', payload: 1 }));
    clients[0].send(JSON.stringify({ type: 'interrupt' }));

    await waitFor(() => (executionController.isInterrupted() ? true : undefined));
    expect(executionController.isInterrupted()).toBe(true);
  });

  test('closing reports the exit code and resolves outstanding asks as skipped', async () => {
    remote.attach(url(), 'explore');
    const answer = executionController.requestInput('never answered');
    await waitFor(frameOf('ask'));

    await remote.close(1);

    expect(await answer).toBeNull();
    expect(remote.isAttached()).toBe(false);
    expect(await waitFor(frameOf('result'))).toMatchObject({ ok: false, exitCode: 1 });
  });

  test('run state logged as data reaches the UI as its own frame, never as a log line', async () => {
    ConfigParser.resetForTesting();
    ConfigParser.setupTestConfig();
    remote.attach(url(), 'explore');
    await waitFor(frameOf('hello'));

    const stateManager = new StateManager(undefined as any, undefined as any);
    stateManager.updateStateFromBasic('https://shop.test/checkout', 'Checkout');
    await new Action({ saveScreenshot: async () => {} } as any, stateManager).saveScreenshot();

    const plan = new Plan('/checkout');
    const scenario = new Test('Buy a hat', 'high', 'the order is placed', '/checkout');
    plan.addTest(scenario);
    scenario.start();
    scenario.finish(TestResult.PASSED);

    saveResearch('checkout_hash', '# Checkout');
    new SessionAnalyst({} as any).writeReport('# Session Analysis');

    await waitFor(frameOf('report'));

    expect(frameOf('state')()).toMatchObject({ url: 'https://shop.test/checkout', path: '/checkout', title: 'Checkout' });
    expect(frameOf('screenshot')().path).toEndWith('.png');

    const tests = received.filter((f) => f.type === 'test');
    expect(tests.map((f) => f.status)).toEqual(['in_progress', 'done']);
    expect(tests[1]).toMatchObject({ scenario: 'Buy a hat', result: 'passed', priority: 'high', url: '/checkout', plan: '/checkout' });

    expect(received.filter((f) => f.type === 'plan').at(-1)).toMatchObject({
      title: '/checkout',
      url: '/checkout',
      tests: [{ scenario: 'Buy a hat', status: 'done', result: 'passed' }],
    });

    expect(frameOf('research')()).toMatchObject({ hash: 'checkout_hash', content: '# Checkout' });
    expect(frameOf('research')().path).toEndWith('research/checkout_hash.md');
    expect(frameOf('report')()).toMatchObject({ content: '# Session Analysis' });
    expect(received.filter((f) => f.type === 'log' && f.level === 'data')).toEqual([]);
  });

  test('a run that can be asked is interactive, whoever installed the callback', () => {
    expect(isInteractive()).toBe(false);
    remote.attach(url(), 'explore');
    expect(isInteractive()).toBe(true);
  });
});
