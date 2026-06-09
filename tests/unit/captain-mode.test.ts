import { describe, expect, it } from 'bun:test';
import { Captain } from '../../src/ai/captain.ts';

function buildCaptain(opts: { state?: any; activeTest?: any; page?: any }) {
  const explorer = {
    activeTest: opts.activeTest || null,
    playwrightHelper: {
      page: opts.page,
    },
    getStateManager: () => ({
      getCurrentState: () => opts.state || null,
    }),
  };

  const explorBot = {
    getExplorer: () => explorer,
  };

  return Object.assign(Object.create(Captain.prototype), { explorBot }) as Captain;
}

function buildCaptainWithExplorer(explorer: any) {
  return Object.assign(Object.create(Captain.prototype), {
    explorBot: {
      getExplorer: () => explorer,
    },
  }) as Captain;
}

describe('Captain modes', () => {
  it('uses idle mode without a loaded page', () => {
    const captain = buildCaptain({});

    expect(captain.getMode()).toBe('idle');
  });

  it('uses web mode when a page state exists', () => {
    const captain = buildCaptain({ state: { url: '/dashboard' } });

    expect(captain.getMode()).toBe('web');
  });

  it('uses test mode while a test is active', () => {
    const captain = buildCaptain({
      activeTest: { sessionName: 'test-session' },
      page: { isClosed: () => false },
      state: { url: '/dashboard' },
    });

    expect(captain.getMode()).toBe('test');
  });

  it('uses heal mode when active test has no usable browser page', () => {
    const captain = buildCaptain({
      activeTest: { sessionName: 'test-session' },
      page: { isClosed: () => true },
      state: { url: '/dashboard' },
    });

    expect(captain.getMode()).toBe('heal');
  });
});

describe('Captain execution recovery', () => {
  it('continues after a fatal browser error is recovered', async () => {
    const captain = buildCaptainWithExplorer({
      handleExecutionError: async () => ({
        action: 'continue',
        recovered: true,
        message: 'Browser was recovered after a fatal page error.',
      }),
    });

    const recovery = await captain.processExecutionError(new Error('Target closed'), { scenario: 'create project' } as any);

    expect(recovery.action).toBe('continue');
    expect(recovery.recovered).toBe(true);
    expect(recovery.message).toContain('Browser was recovered');
  });

  it('stops when a fatal browser error cannot be recovered', async () => {
    const captain = buildCaptainWithExplorer({
      handleExecutionError: async () => ({
        action: 'stop',
        recovered: false,
        message: 'Browser could not be recovered',
      }),
    });

    const recovery = await captain.processExecutionError(new Error('Target closed'), { scenario: 'create project' } as any);

    expect(recovery.action).toBe('stop');
    expect(recovery.recovered).toBe(false);
  });

  it('continues when browser restart recovers after page recovery fails', async () => {
    const captain = buildCaptainWithExplorer({
      handleExecutionError: async () => ({
        action: 'continue',
        recovered: true,
        message: 'Browser was recovered after a fatal page error.',
      }),
    });

    const recovery = await captain.processExecutionError(new Error('Target closed'), { scenario: 'create project' } as any);

    expect(recovery.action).toBe('continue');
    expect(recovery.recovered).toBe(true);
  });

  it('continues with guidance for non-fatal execution errors', async () => {
    const captain = buildCaptainWithExplorer({
      handleExecutionError: async () => ({
        action: 'continue',
        message: 'Previous execution error: Locator not found. Investigate the current state and choose a different approach.',
      }),
    });

    const recovery = await captain.processExecutionError(new Error('Locator not found'), { scenario: 'create project' } as any);

    expect(recovery.action).toBe('continue');
    expect(recovery.recovered).toBeUndefined();
    expect(recovery.message).toContain('Previous execution error');
  });
});
