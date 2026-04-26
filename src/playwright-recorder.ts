import { readFile } from 'node:fs/promises';
// @ts-ignore — package ships a .js re-export without typings for this sub-path
import * as playwrightUtils from 'playwright-core/lib/utils';
import { createDebug } from './utils/logger.ts';

const debugLog = createDebug('explorbot:playwright-recorder');

const RECORDABLE: Record<string, Set<string>> = {
  Frame: new Set(['click', 'dblclick', 'fill', 'selectOption', 'press', 'type', 'check', 'uncheck', 'hover', 'tap', 'focus', 'setInputFiles', 'scrollIntoViewIfNeeded', 'dragTo', 'goto', 'setContent']),
  Page: new Set(['goBack', 'goForward', 'reload', 'keyboardPress', 'keyboardType', 'keyboardDown', 'keyboardUp', 'keyboardInsertText', 'mouseClick', 'mouseDblclick', 'mouseMove', 'mouseDown', 'mouseUp', 'mouseWheel']),
};

const PLAYWRIGHT_INCOMPATIBLE = "Playwright output is not compatible with this Playwright version (playwright-core/lib/utils does not expose asLocator). Use output.framework: 'codeceptjs' instead, or pin Playwright to a version shipping lib/utils/isomorphic/locatorGenerators.js.";

function getAsLocator(): (lang: string, selector: string) => string {
  const fn = (playwrightUtils as any)?.asLocator;
  if (typeof fn !== 'function') throw new Error(PLAYWRIGHT_INCOMPATIBLE);
  return fn;
}

export interface TraceCall {
  class: string;
  method: string;
  params: Record<string, any>;
}

export interface VerificationStep {
  name: string;
  args: any[];
}

export class PlaywrightRecorder {
  private context: any = null;
  private tracing: any = null;
  private active = false;
  private nextGroupId = 0;
  private verifications: VerificationStep[] = [];

  recordVerification(steps: VerificationStep[]): void {
    if (!steps?.length) return;
    const seen = new Set(this.verifications.map((s) => `${s.name}:${JSON.stringify(s.args)}`));
    for (const step of steps) {
      const key = `${step.name}:${JSON.stringify(step.args)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      this.verifications.push(step);
    }
  }

  drainVerifications(): VerificationStep[] {
    const drained = this.verifications;
    this.verifications = [];
    return drained;
  }

  async start(browserContext: any): Promise<void> {
    if (this.active) return;
    if (!browserContext?.tracing) {
      debugLog('start: no tracing on browserContext, recorder inactive');
      return;
    }
    this.context = browserContext;
    this.tracing = browserContext.tracing;
    try {
      await this.tracing.start({});
      this.active = true;
      debugLog('tracing started');
    } catch (err) {
      debugLog('tracing.start failed:', err);
    }
  }

  async beginAction(title: string): Promise<string | null> {
    if (!this.active) return null;
    const safe = title.replace(/\s+/g, ' ').slice(0, 80);
    const groupId = `explorbot#${++this.nextGroupId}:${safe}`;
    try {
      await this.tracing.group(groupId);
      return groupId;
    } catch (err) {
      debugLog('tracing.group failed:', err);
      return null;
    }
  }

  async endAction(): Promise<void> {
    if (!this.active) return;
    try {
      await this.tracing.groupEnd();
    } catch (err) {
      debugLog('tracing.groupEnd failed:', err);
    }
  }

  async exportChunk(): Promise<Map<string, TraceCall[]>> {
    if (!this.active) return new Map();
    const channel = this.tracing._channel;
    if (!channel?.tracingStopChunk || !channel.tracingStartChunk) {
      debugLog('exportChunk: no _channel access, returning empty');
      return new Map();
    }

    let entries: Array<{ name: string; value: string }> = [];
    try {
      const result = await channel.tracingStopChunk({ mode: 'entries' });
      entries = result?.entries || [];
    } catch (err) {
      debugLog('tracingStopChunk failed:', err);
      return new Map();
    }

    const traceEntry = entries.find((e) => e.name === 'trace.trace');

    let groups = new Map<string, TraceCall[]>();
    if (traceEntry) {
      try {
        const ndjson = await readFile(traceEntry.value, 'utf8');
        groups = parseTrace(ndjson);
      } catch (err) {
        debugLog('reading trace.trace failed:', err);
      }
    }

    try {
      await channel.tracingStartChunk({});
    } catch (err) {
      debugLog('tracingStartChunk failed after export:', err);
      this.active = false;
    }

    return groups;
  }

  async stop(): Promise<void> {
    if (!this.active) return;
    try {
      await this.tracing.stop({});
    } catch (err) {
      debugLog('tracing.stop failed:', err);
    }
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }
}

interface ParsedBefore {
  callId: string;
  class: string;
  method: string;
  params: Record<string, any>;
  parentId?: string;
  title?: string;
  failed: boolean;
}

function parseTrace(ndjson: string): Map<string, TraceCall[]> {
  const befores = new Map<string, ParsedBefore>();
  const groupTitleByCallId = new Map<string, string>();

  for (const line of ndjson.split('\n')) {
    if (!line) continue;
    let evt: any;
    try {
      evt = JSON.parse(line);
    } catch {
      continue;
    }
    if (evt.type === 'before') {
      befores.set(evt.callId, {
        callId: evt.callId,
        class: evt.class,
        method: evt.method,
        params: evt.params || {},
        parentId: evt.parentId,
        title: evt.title,
        failed: false,
      });
      if (evt.class === 'Tracing' && evt.method === 'tracingGroup' && typeof evt.title === 'string') {
        groupTitleByCallId.set(evt.callId, evt.title);
      }
      continue;
    }
    if (evt.type === 'after') {
      const rec = befores.get(evt.callId);
      if (rec && evt.error) rec.failed = true;
    }
  }

  const groups = new Map<string, TraceCall[]>();
  for (const title of groupTitleByCallId.values()) {
    groups.set(title, []);
  }

  for (const rec of befores.values()) {
    if (rec.failed) continue;
    if (rec.class === 'Tracing') continue;
    if (!rec.parentId) continue;
    const groupTitle = groupTitleByCallId.get(rec.parentId);
    if (!groupTitle) continue;
    const allowed = RECORDABLE[rec.class];
    if (!allowed?.has(rec.method)) continue;
    groups.get(groupTitle)!.push({ class: rec.class, method: rec.method, params: rec.params });
  }

  return groups;
}

export function renderCall(call: TraceCall): string {
  const asLocator = getAsLocator();
  const { class: cls, method, params } = call;

  if (cls === 'Frame') {
    if (method === 'goto') return `await page.goto(${quote(params.url)});`;
    if (method === 'setContent') return `await page.setContent(${quote(params.html)});`;
    const locator = `page.${asLocator('javascript', params.selector || '')}`;
    if (method === 'click') return `await ${locator}.click();`;
    if (method === 'dblclick') return `await ${locator}.dblclick();`;
    if (method === 'fill') return `await ${locator}.fill(${quote(params.value ?? '')});`;
    if (method === 'press') return `await ${locator}.press(${quote(params.key ?? '')});`;
    if (method === 'type') return `await ${locator}.type(${quote(params.text ?? '')});`;
    if (method === 'check') return `await ${locator}.check();`;
    if (method === 'uncheck') return `await ${locator}.uncheck();`;
    if (method === 'hover') return `await ${locator}.hover();`;
    if (method === 'tap') return `await ${locator}.tap();`;
    if (method === 'focus') return `await ${locator}.focus();`;
    if (method === 'scrollIntoViewIfNeeded') return `await ${locator}.scrollIntoViewIfNeeded();`;
    if (method === 'setInputFiles') return `await ${locator}.setInputFiles(${formatFiles(params.localPaths ?? params.files)});`;
    if (method === 'selectOption') return `await ${locator}.selectOption(${formatSelectOption(params.options)});`;
    if (method === 'dragTo') return `await ${locator}.dragTo(page.locator(${quote(params.targetSelector ?? '')}));`;
  }

  if (cls === 'Page') {
    if (method === 'goBack') return 'await page.goBack();';
    if (method === 'goForward') return 'await page.goForward();';
    if (method === 'reload') return 'await page.reload();';
    if (method === 'keyboardPress') return `await page.keyboard.press(${quote(params.key ?? '')});`;
    if (method === 'keyboardType') return `await page.keyboard.type(${quote(params.text ?? '')});`;
    if (method === 'keyboardDown') return `await page.keyboard.down(${quote(params.key ?? '')});`;
    if (method === 'keyboardUp') return `await page.keyboard.up(${quote(params.key ?? '')});`;
    if (method === 'keyboardInsertText') return `await page.keyboard.insertText(${quote(params.text ?? '')});`;
    if (method === 'mouseClick') return `await page.mouse.click(${params.x ?? 0}, ${params.y ?? 0});`;
    if (method === 'mouseDblclick') return `await page.mouse.dblclick(${params.x ?? 0}, ${params.y ?? 0});`;
    if (method === 'mouseMove') return `await page.mouse.move(${params.x ?? 0}, ${params.y ?? 0});`;
    if (method === 'mouseDown') return 'await page.mouse.down();';
    if (method === 'mouseUp') return 'await page.mouse.up();';
    if (method === 'mouseWheel') return `await page.mouse.wheel(${params.deltaX ?? 0}, ${params.deltaY ?? 0});`;
  }

  return `// TODO(playwright): ${cls}.${method}(${JSON.stringify(params)})`;
}

function quote(value: any): string {
  return JSON.stringify(String(value ?? ''));
}

function formatFiles(files: any): string {
  if (!files) return '[]';
  if (Array.isArray(files)) {
    if (files.length === 1) return quote(files[0]);
    return `[${files.map((f) => quote(f)).join(', ')}]`;
  }
  return quote(files);
}

function formatSelectOption(options: any): string {
  if (!options) return `''`;
  const list = Array.isArray(options) ? options : [options];
  const values = list.map((o) => o?.valueOrLabel ?? o?.value ?? o?.label ?? '');
  if (values.length === 1) return quote(values[0]);
  return `[${values.map((v) => quote(v)).join(', ')}]`;
}

export function renderAssertion(assertion: { name: string; args: any[] }): string {
  const args = assertion.args;
  if (assertion.name === 'see' && typeof args[0] === 'string') {
    return `await expect(page).toContainText(${JSON.stringify(args[0])});`;
  }
  if (assertion.name === 'dontSee' && typeof args[0] === 'string') {
    return `await expect(page).not.toContainText(${JSON.stringify(args[0])});`;
  }
  if (assertion.name === 'seeElement' && typeof args[0] === 'string') {
    return `await expect(page.locator(${JSON.stringify(args[0])})).toBeVisible();`;
  }
  if (assertion.name === 'dontSeeElement' && typeof args[0] === 'string') {
    return `await expect(page.locator(${JSON.stringify(args[0])})).toBeHidden();`;
  }
  if (assertion.name === 'seeInField' && typeof args[0] === 'string' && args[1] !== undefined) {
    return `await expect(page.locator(${JSON.stringify(args[0])})).toHaveValue(${JSON.stringify(String(args[1]))});`;
  }
  if (assertion.name === 'dontSeeInField' && typeof args[0] === 'string' && args[1] !== undefined) {
    return `await expect(page.locator(${JSON.stringify(args[0])})).not.toHaveValue(${JSON.stringify(String(args[1]))});`;
  }
  if (assertion.name === 'seeInCurrentUrl' && typeof args[0] === 'string') {
    return `await expect(page).toHaveURL(new RegExp(${JSON.stringify(args[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))}));`;
  }
  if (assertion.name === 'dontSeeInCurrentUrl' && typeof args[0] === 'string') {
    return `await expect(page).not.toHaveURL(new RegExp(${JSON.stringify(args[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))}));`;
  }
  return `// TODO(playwright): ${assertion.name}(${assertion.args.map((a) => JSON.stringify(a)).join(', ')})`;
}

export { parseTrace };
