import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { NetworkCall } from '../../../src/action-result.ts';
import type { ExecutedStep } from '../../../src/action.ts';
import { type LogDestination, type TaggedLogEntry, addDestination } from '../../../src/utils/logger.ts';
import { truncate } from '../../../src/utils/strings.ts';
import type { VideoSegment } from './video-editor.ts';

export const TIMELINE_FILE = 'timeline.json';
export const OVERLAY_KINDS = ['console-errors', 'console-logs', 'network', 'network-errors'];

const STEP_TAIL_SECONDS = 1.5;
const OVERLAY_LINES = 5;
const OVERLAY_LINE_CAP = 110;

export class VideoTimeline implements LogDestination {
  private active = false;
  private startedAt = 0;

  constructor(readonly steps: TimelineStep[] = []) {}

  static load(dir: string): VideoTimeline | null {
    const file = path.join(dir, TIMELINE_FILE);
    if (!existsSync(file)) return null;
    return new VideoTimeline(JSON.parse(readFileSync(file, 'utf-8')).steps || []);
  }

  start(startedAt: number): void {
    this.startedAt = startedAt;
    this.active = true;
    addDestination(this);
  }

  save(dir: string): void {
    this.active = false;
    writeFileSync(path.join(dir, TIMELINE_FILE), JSON.stringify({ steps: this.steps }, null, 2), 'utf-8');
  }

  isEnabled(): boolean {
    return this.active;
  }

  write(entry: TaggedLogEntry): void {
    if (entry.content !== 'action') return;
    const payload = entry.originalArgs?.[1] || {};
    const steps = ((payload.steps || []) as ExecutedStep[]).filter((step) => step.startedAt && step.endedAt);
    if (!steps.length) return;

    const logs = (payload.logs || []) as Array<{ type: string; text: string }>;
    const requests = (payload.requests || []) as NetworkCall[];
    const events: TimelineEvent[] = [
      ...logs.map((log) => ({ source: 'console' as const, error: log.type === 'error', text: `console ${log.type}: ${log.text}` })),
      ...requests.map((request) => ({ source: 'network' as const, error: request.status >= 400, text: `${request.method} ${request.path} ${request.status}` })),
    ];
    // what an execution logged or requested is shown on the step that ended it
    steps.forEach((step, index) => {
      const at: TimelineStep = { label: step.command, ok: step.success, start: this.seconds(step.startedAt!), end: this.seconds(step.endedAt!), events: [] };
      if (index === steps.length - 1) at.events = events;
      this.steps.push(at);
    });
  }

  segments(pick: string, overlays: string[]): VideoSegment[] {
    if (!pick) return this.steps.map((_, index) => this.stepSegment(index, overlays));
    const segments: VideoSegment[] = [];
    for (const part of pick
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)) {
      if (part.startsWith('@')) {
        segments.push(...this.rangeSegments(part, overlays));
        continue;
      }
      const [first, last = first] = part.split('-').map((value) => Number.parseInt(value, 10));
      for (let number = first; number <= last; number++) {
        if (!this.steps[number - 1]) throw new Error(`step ${number} does not exist: this recording has ${this.steps.length} steps`);
        segments.push(this.stepSegment(number - 1, overlays));
      }
    }
    return segments;
  }

  private stepSegment(index: number, overlays: string[]): VideoSegment {
    const step = this.steps[index];
    const next = this.steps[index + 1]?.start ?? Number.POSITIVE_INFINITY;
    return this.withOverlay({ start: step.start, end: Math.min(next, step.end + STEP_TAIL_SECONDS) }, step, overlays);
  }

  private rangeSegments(part: string, overlays: string[]): VideoSegment[] {
    const [start, end] = part
      .slice(1)
      .split('-')
      .map((value) => Number.parseFloat(value));
    if (!(end > start)) throw new Error(`"${part}" must be @<from>-<to> in seconds, e.g. @4.0-9.5`);
    const cuts = [start, ...this.steps.map((step) => step.start).filter((time) => time > start && time < end), end];
    return cuts.slice(1).map((cut, index) => {
      const from = cuts[index];
      const step = this.steps.findLast((candidate) => candidate.start <= from);
      return this.withOverlay({ start: from, end: cut }, step, overlays);
    });
  }

  private withOverlay(segment: VideoSegment, step: TimelineStep | undefined, overlays: string[]): VideoSegment {
    const shown = (step?.events || []).filter((event) => overlays.some((kind) => overlayShows(kind, event)));
    if (!shown.length) return segment;
    segment.overlay = [...new Set(shown.map((event) => truncate(event.text, OVERLAY_LINE_CAP)))].slice(0, OVERLAY_LINES);
    segment.alert = shown.some((event) => event.error);
    return segment;
  }

  private seconds(time: number): number {
    return Math.max(0, (time - this.startedAt) / 1000);
  }
}

function overlayShows(kind: string, event: TimelineEvent): boolean {
  if (kind === 'console-errors') return event.source === 'console' && event.error;
  if (kind === 'console-logs') return event.source === 'console' && !event.error;
  if (kind === 'network-errors') return event.source === 'network' && event.error;
  if (kind === 'network') return event.source === 'network';
  return false;
}

export interface TimelineStep {
  label: string;
  ok: boolean;
  start: number;
  end: number;
  events: TimelineEvent[];
}

interface TimelineEvent {
  source: 'console' | 'network';
  error: boolean;
  text: string;
}
