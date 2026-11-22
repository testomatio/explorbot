import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { tag } from '../../../src/utils/logger.ts';
import { type TimelineStep, VideoTimeline } from '../src/video-timeline.ts';

function step(label: string, start: number, end: number, events: TimelineStep['events'] = []): TimelineStep {
  return { label, ok: true, start, end, events };
}

const timeline = new VideoTimeline([
  step('I.click("Add")', 1, 2),
  step('I.click("Checkout")', 4, 5, [
    { source: 'console', error: true, text: 'console error: boom' },
    { source: 'console', error: false, text: 'console log: loaded' },
    { source: 'network', error: true, text: 'POST /api/orders 500' },
    { source: 'network', error: false, text: 'GET /api/cart 200' },
  ]),
  step('I.see("Total")', 5.5, 6),
]);

describe('VideoTimeline', () => {
  test('records each executed step against the recording start, with what the execution logged on its last step', () => {
    const recording = new VideoTimeline();
    const startedAt = performance.now();
    recording.start(startedAt);
    tag('data').log('action', {
      steps: [
        { command: 'I.fillField("q", "x")', success: true, startedAt: startedAt + 1000, endedAt: startedAt + 1500 },
        { command: 'I.click("Go")', success: false, startedAt: startedAt + 1500, endedAt: startedAt + 2500 },
      ],
      logs: [{ type: 'error', text: 'boom' }],
      requests: [{ method: 'GET', path: '/api', status: 404 }],
    });
    const dir = mkdtempSync(path.join(tmpdir(), 'prima-timeline-'));
    recording.save(dir);

    const steps = VideoTimeline.load(dir)?.steps || [];
    expect(steps.map((entry) => [entry.label, entry.ok, Number(entry.start.toFixed(2)), Number(entry.end.toFixed(2))])).toEqual([
      ['I.fillField("q", "x")', true, 1, 1.5],
      ['I.click("Go")', false, 1.5, 2.5],
    ]);
    expect(steps[0].events).toEqual([]);
    expect(steps[1].events.map((event) => event.text)).toEqual(['console error: boom', 'GET /api 404']);
  });

  test('a picked step runs until the next one starts, at most a moment past its end', () => {
    expect(timeline.segments('1,3', []).map(({ start, end }) => [start, end])).toEqual([
      [1, 2 + 1.5],
      [5.5, 6 + 1.5],
    ]);
    expect(timeline.segments('2', [])[0].end).toBe(5.5);
  });

  test('every step is kept when none is picked', () => {
    expect(timeline.segments('', [])).toHaveLength(3);
  });

  test('an overlay shows only the kinds asked for, and only on its own step', () => {
    const segments = timeline.segments('1-3', ['console-errors', 'network-errors']);
    expect(segments.map((segment) => segment.overlay)).toEqual([undefined, ['console error: boom', 'POST /api/orders 500'], undefined]);
    expect(segments[1].alert).toBe(true);
    expect(timeline.segments('2', ['console-logs', 'network'])[0].overlay).toEqual(['console log: loaded', 'POST /api/orders 500', 'GET /api/cart 200']);
  });

  test('a time range is split where steps start, so an overlay ends with its step', () => {
    const segments = timeline.segments('@3-5.8', ['console-errors']);
    expect(segments.map(({ start, end, overlay }) => [start, end, overlay?.length || 0])).toEqual([
      [3, 4, 0],
      [4, 5.5, 1],
      [5.5, 5.8, 0],
    ]);
  });

  test('a step that does not exist is refused', () => {
    expect(() => timeline.segments('7', [])).toThrow('this recording has 3 steps');
    expect(() => timeline.segments('@5-2', [])).toThrow('@<from>-<to>');
  });
});
