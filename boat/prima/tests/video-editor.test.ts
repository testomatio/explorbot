import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type VideoClip, VideoEditor } from '../src/video-editor.ts';

const hasFfmpeg = !spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).error;
let dir = '';

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'prima-video-test-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function clip(name: string, source: string, edits: Partial<VideoClip> = {}): VideoClip {
  const file = path.join(dir, `${name}.webm`);
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `${source}:rate=25:duration=4`, '-c:v', 'libvpx', file]);
  return { number: '0001', title: name, file, ...edits };
}

function duration(file: string): number {
  const run = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', file], { encoding: 'utf-8' });
  return Number(JSON.parse(run.stdout).format.duration);
}

describe.skipIf(!hasFfmpeg)('VideoEditor', () => {
  test('joins moving clips in the given order and leaves out a clip where nothing moved', () => {
    const output = path.join(dir, 'joined.webm');
    const { used, still } = new VideoEditor().render([clip('second', 'testsrc2=size=320x240'), clip('blank', 'color=c=white:size=320x240'), clip('first', 'testsrc=size=320x240')], output);

    expect(used.map((entry) => entry.title)).toEqual(['second', 'first']);
    expect(still.map((entry) => entry.title)).toEqual(['blank']);
    expect(existsSync(output)).toBe(true);
  });

  test('scales every clip to the size of the first one', () => {
    const output = path.join(dir, 'sized.webm');
    new VideoEditor().render([clip('wide', 'testsrc=size=640x360'), clip('small', 'testsrc2=size=320x240')], output);

    const run = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', output], { encoding: 'utf-8' });
    const [stream] = JSON.parse(run.stdout).streams;
    expect([stream.width, stream.height]).toEqual([640, 360]);
  });

  test('a wait on an unchanged page holds for a second, not its real length', () => {
    const output = path.join(dir, 'condensed.webm');
    const waiting = path.join(dir, 'waiting.webm');
    spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25:duration=1', '-f', 'lavfi', '-i', 'color=c=white:size=320x240:rate=25:duration=8', '-filter_complex', '[0][1]concat=n=2:v=1', '-c:v', 'libvpx', waiting]);
    new VideoEditor().render([{ number: '0001', title: 'waiting', file: waiting }], output);

    expect(duration(output)).toBeLessThan(4);
  });

  test('speed and hold change the clip length, and a caption needs no escaping', () => {
    const plain = path.join(dir, 'plain.webm');
    const edited = path.join(dir, 'edited.webm');
    new VideoEditor().render([clip('a', 'testsrc=size=320x240')], plain);
    new VideoEditor().render([clip('b', 'testsrc=size=320x240', { speed: 2, hold: 3, caption: "Cart total: it's 3 items" })], edited);

    expect(duration(plain)).toBeCloseTo(5, 0);
    expect(duration(edited)).toBeCloseTo(2 + 1 + 3, 0);
  });

  test('writes nothing when no clip moved', () => {
    const output = path.join(dir, 'none.webm');
    const { used } = new VideoEditor().render([clip('blank only', 'color=c=black:size=320x240')], output);

    expect(used).toEqual([]);
    expect(existsSync(output)).toBe(false);
  });
});

describe.skipIf(!hasFfmpeg)('VideoEditor steps', () => {
  test('keeps only the given segments, and a step longer than the step time is sped up to fit', () => {
    const cut = path.join(dir, 'cut.webm');
    const capped = path.join(dir, 'capped.webm');
    const segments = [
      { start: 0, end: 1 },
      { start: 2, end: 4 },
    ];
    new VideoEditor().render([clip('steps', 'testsrc=size=320x240', { segments })], cut);
    new VideoEditor().render([clip('capped-source', 'testsrc=size=320x240', { segments, stepTime: 0.5 })], capped);

    expect(duration(cut)).toBeCloseTo(3 + 1, 0);
    expect(duration(capped)).toBeLessThan(0.5 + 0.5 + 1 + 0.3);
  });

  test('draws an overlay over its segment without escaping', () => {
    const output = path.join(dir, 'overlay.webm');
    const { used } = new VideoEditor().render(
      [
        clip('overlay-source', 'testsrc=size=320x240', {
          segments: [
            { start: 0, end: 2, overlay: ["console error: 100% it's broken: {x}"], alert: true },
            { start: 2, end: 3 },
          ],
        }),
      ],
      output
    );

    expect(used).toHaveLength(1);
    expect(existsSync(output)).toBe(true);
  });
});
