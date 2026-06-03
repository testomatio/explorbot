import { describe, expect, it } from 'bun:test';
import { WithScreencast } from '../../src/ai/historian/screencast.ts';

function buildScreencastHost(stop: () => Promise<void>) {
  const Host = WithScreencast(Object as unknown as new () => object);
  const host: any = new Host();
  host.savedFiles = new Set<string>();
  host.screencastActive = true;
  host.screencastPath = 'output/screencasts/test.webm';
  host.screencastPage = {
    screencast: { stop },
  };
  const artifacts: string[] = [];
  host.screencastTask = {
    addArtifact: (path: string) => artifacts.push(path),
  };
  return { host, artifacts };
}

describe('Historian screencast cleanup', () => {
  it('does not save screencast artifact when browser was closed before stop', async () => {
    const { host, artifacts } = buildScreencastHost(async () => {
      throw new Error('stop: Target page, context or browser has been closed');
    });

    await host.stopScreencast();

    expect(host.savedFiles.size).toBe(0);
    expect(artifacts).toHaveLength(0);
    expect(host.isScreencastActive()).toBe(false);
  });

  it('saves screencast artifact after a clean stop', async () => {
    const { host, artifacts } = buildScreencastHost(async () => {});

    await host.stopScreencast();

    expect(host.savedFiles.has('output/screencasts/test.webm')).toBe(true);
    expect(artifacts).toEqual(['output/screencasts/test.webm']);
  });
});
