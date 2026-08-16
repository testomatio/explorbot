import type { Command } from 'commander';
import stripAnsi from 'strip-ansi';
import { type ActivityEntry, addActivityListener } from './activity.ts';
import { executionController } from './execution-controller.ts';
import { type LogDestination, type TaggedLogEntry, addDestination } from './utils/logger.ts';

const QUEUE_CAP = 1000;
const CONTENT_CAP = 8000;
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 10_000;
const ASK_TIMEOUT_MS = 15 * 60_000;
const FLUSH_TIMEOUT_MS = 3000;

/**
 * Streams a run to a remote UI over one WebSocket, dialling out so a child
 * process and a CI bot are the same case.
 *
 * It **is** a LogDestination — that is the whole integration on the logger's
 * side — and it answers asks by installing itself as the execution
 * controller's input callback. Nothing else in explorbot knows it exists.
 */
export class Remote implements LogDestination {
  private url: string | null = null;
  private socket: WebSocket | null = null;
  private queue: Frame[] = [];
  private reconnectDelay = RECONNECT_BASE_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private asks = new Map<string, (value: string | null) => void>();
  private askCounter = 0;
  private lastActivity: string | null = null;

  registerOption(program: Command): void {
    program.option('--ws <url>', 'Stream this run to a remote UI over WebSocket');
    program.hook('preAction', (_thisCommand, actionCommand) => {
      const url = actionCommand.optsWithGlobals().ws || process.env.EXPLORBOT_WS_URL;
      if (!url) return;
      this.attach(String(url), this.commandPath(actionCommand));
    });
  }

  attach(url: string, command: string): void {
    if (this.url) return;
    this.url = url;
    this.connect();

    this.send('hello', { command, cwd: process.cwd(), pid: process.pid });
    addDestination(this);
    executionController.setInputCallback((prompt) => this.ask(prompt));
    addActivityListener((activity) => this.reportActivity(activity));
  }

  isAttached(): boolean {
    return !!this.url;
  }

  send(type: string, data: Record<string, unknown> = {}): void {
    if (!this.url) return;
    const frame: Frame = { type, ts: Date.now(), ...data };
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.push(frame);
      return;
    }
    this.queue.push(frame);
    if (this.queue.length > QUEUE_CAP) this.queue.splice(0, this.queue.length - QUEUE_CAP);
  }

  ask(prompt: string): Promise<string | null> {
    if (!this.url) return Promise.resolve(null);
    this.askCounter++;
    const askId = `ask-${this.askCounter}`;
    this.send('ask', { askId, prompt });

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.asks.delete(askId);
        resolve(null);
      }, ASK_TIMEOUT_MS);
      this.asks.set(askId, (value) => {
        clearTimeout(timer);
        resolve(value);
      });
    });
  }

  async close(exitCode: number): Promise<void> {
    if (!this.url) return;
    this.send('result', { ok: exitCode === 0, exitCode });
    await this.flush();

    this.url = null;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    // Whoever asks next has nobody to ask — leaving the callback installed would
    // route them into a closed socket and park them until the ask times out.
    executionController.clearInputCallback();
    for (const resolve of this.asks.values()) resolve(null);
    this.asks.clear();
    this.queue = [];
    this.socket?.close();
    this.socket = null;
  }

  isEnabled(): boolean {
    return this.isAttached();
  }

  /**
   * The entry as the logger already built it, so the `LogType` reaches the UI
   * as the frame's level and each kind is styled there instead of being scraped
   * back out of flattened text.
   */
  write(entry: TaggedLogEntry): void {
    if (entry.type === 'html') return;
    let content = stripAnsi(entry.content ?? '');
    if (content.length > CONTENT_CAP) content = `${content.slice(0, CONTENT_CAP)}… (${content.length} chars)`;
    this.send('log', {
      level: entry.type,
      content,
      namespace: entry.namespace,
      error: this.errorOf(entry.originalArgs),
    });
  }

  private connect(): void {
    if (!this.url) return;

    let opening: WebSocket;
    try {
      opening = new WebSocket(this.url);
    } catch {
      this.reconnect();
      return;
    }
    this.socket = opening;

    opening.addEventListener('open', () => {
      this.reconnectDelay = RECONNECT_BASE_MS;
      this.drain();
    });

    opening.addEventListener('message', (event: MessageEvent) => this.receive(String(event.data)));

    opening.addEventListener('close', () => {
      if (this.socket !== opening) return;
      this.socket = null;
      this.reconnect();
    });

    // A failed connection always closes too, which is where the retry is scheduled.
    opening.addEventListener('error', () => {});
  }

  private reconnect(): void {
    if (!this.url || this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private async flush(): Promise<void> {
    const deadline = Date.now() + FLUSH_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.drain();
        if (!this.queue.length && !this.socket.bufferedAmount) return;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  private drain(): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    const pending = this.queue;
    this.queue = [];
    for (const frame of pending) this.push(frame);
  }

  private push(frame: Frame): void {
    try {
      this.socket?.send(JSON.stringify(frame));
    } catch {
      this.queue.push(frame);
    }
  }

  private receive(raw: string): void {
    let frame: Frame;
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }
    if (frame.type === 'interrupt') {
      executionController.interrupt();
      return;
    }
    const resolve = this.asks.get(String(frame.askId));
    if (!resolve) return;
    this.asks.delete(String(frame.askId));
    resolve((frame.value as string | null) ?? null);
  }

  /** A new listener is primed with the current activity, which at attach time is
   *  nothing — so skip repeats, the priming null included. */
  private reportActivity(activity: ActivityEntry | null): void {
    const message = activity?.message ?? null;
    if (message === this.lastActivity) return;
    this.lastActivity = message;
    this.send('activity', { message, kind: activity?.type });
  }

  private errorOf(args: any[] | undefined): string | undefined {
    const failure = args?.[1] ?? args?.[0]?.error;
    if (!failure) return undefined;
    if (typeof failure === 'string') return failure;
    if (typeof failure.message === 'string') return failure.message;
    return undefined;
  }

  private commandPath(command: Command): string {
    const parts: string[] = [];
    let node: Command | null = command;
    while (node) {
      parts.unshift(node.name());
      node = node.parent;
    }
    return parts.slice(1).join(' ') || parts.join(' ');
  }
}

export const remote = new Remote();

/** Whatever the run wants to say. Not a schema — the UI renders what it knows
 *  and ignores the rest, so either side can start sending more at any time. */
type Frame = { type: string; ts: number; [key: string]: unknown };
