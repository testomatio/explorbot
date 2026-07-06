const PADDING_2X = 24;
const FONT_WIDTH_RATIO = 0.66;
const LINE_HEIGHT = 1.5;
const FONT_FILL_DIVISOR = 23.4;
const MAX_SIDE_MARGIN = 0.05;

export const SIZE_PRESETS: Record<string, { width: number; height: number }> = {
  landscape: { width: 1920, height: 1080 },
  vertical: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 },
};

export function computeLayout(W: number, H: number, browserAR: number): Layout {
  const ar = W / H;
  if (ar >= 1.4) return finalize(wideBoxes(W, H, browserAR), W, H, 'wide', true);
  if (ar <= 0.8) return finalize(tallBoxes(W, H, browserAR), W, H, 'tall', false);
  return finalize(squareBoxes(W, H, browserAR), W, H, 'square', true);
}

function barHeightFor(H: number): number {
  return clamp(Math.round(H * 0.033), 28, 48);
}

function wideBoxes(W: number, H: number, browserAR: number): Boxes {
  const barH = barHeightFor(H);
  let windowH = 0.86 * H;
  let vh = windowH - barH;
  let vw = vh * browserAR;
  if (vw > 0.72 * W) {
    vw = 0.72 * W;
    vh = vw / browserAR;
    windowH = vh + barH;
  }
  const tw = 0.46 * W;
  const th = 0.38 * H;
  const overhangX = 0.12 * tw;
  const hangY = 0.25 * th;
  const groupW = vw + overhangX;
  const groupH = windowH + hangY;
  const croppedW = Math.min(W, groupW / (1 - 2 * MAX_SIDE_MARGIN));
  const gx = (croppedW - groupW) / 2;
  const gy = (H - groupH) / 2;
  const bx = gx + overhangX;
  const by = gy;
  return { browser: { x: bx, y: by, w: vw, h: windowH }, terminal: { x: gx, y: by + windowH - 0.75 * th, w: tw, h: th }, barH, canvasW: croppedW };
}

function squareBoxes(W: number, H: number, browserAR: number): Boxes {
  const barH = barHeightFor(H);
  const m = Math.round(0.03 * Math.min(W, H));
  let vw = W - 2 * m;
  let vh = vw / browserAR;
  let windowH = vh + barH;
  if (windowH > 0.72 * H) {
    windowH = 0.72 * H;
    vh = windowH - barH;
    vw = vh * browserAR;
  }
  const tw = 0.62 * W;
  const th = 0.3 * H;
  const hangY = 0.25 * th;
  const gy = (H - (windowH + hangY)) / 2;
  const bx = (W - vw) / 2;
  const tx = Math.max(m, bx);
  return { browser: { x: bx, y: gy, w: vw, h: windowH }, terminal: { x: tx, y: gy + windowH - 0.75 * th, w: tw, h: th }, barH };
}

function tallBoxes(W: number, H: number, browserAR: number): Boxes {
  const barH = barHeightFor(H);
  let vw = W;
  let vh = W / browserAR;
  let windowH = vh + barH;
  let bx = 0;
  if (windowH > 0.6 * H) {
    windowH = 0.6 * H;
    vh = windowH - barH;
    vw = vh * browserAR;
    bx = (W - vw) / 2;
  }
  return { browser: { x: bx, y: 0, w: vw, h: windowH }, terminal: { x: 0, y: windowH, w: W, h: H - windowH }, barH };
}

function finalize(boxes: Boxes, W: number, H: number, mode: LayoutMode, shadows: boolean): Layout {
  const browser = evenBox(boxes.browser);
  const terminal = evenBox(boxes.terminal);
  const canvasW = boxes.canvasW ?? W;
  const windowBar = even(boxes.barH);
  const termContentH = terminal.h - windowBar;
  const scale = Math.min(2, 1600 / Math.max(terminal.w, termContentH));
  const vhsWidth = even(terminal.w * scale);
  const vhsHeight = even(termContentH * scale);
  const fontSize = clamp(Math.round((vhsHeight - PADDING_2X * 2) / FONT_FILL_DIVISOR), 22, 56);
  const cols = Math.floor((vhsWidth - PADDING_2X * 2) / (fontSize * FONT_WIDTH_RATIO));
  const rows = Math.floor((vhsHeight - PADDING_2X * 2) / (fontSize * LINE_HEIGHT));
  const vhsFramerate = framerateFor(vhsWidth * vhsHeight);
  return {
    W: even(canvasW),
    H: even(H),
    mode,
    browser,
    terminal,
    windowBar,
    radius: clamp(Math.round(0.015 * H), 12, 24),
    vhsWidth,
    vhsHeight,
    vhsFramerate,
    fontSize,
    lineHeight: LINE_HEIGHT,
    cols,
    rows,
    shadows,
  };
}

function evenBox(box: Box): Box {
  return { x: even(box.x), y: even(box.y), w: even(box.w), h: even(box.h) };
}

function even(n: number): number {
  return 2 * Math.floor(n / 2);
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

function framerateFor(pixels: number): number {
  if (pixels > 2_000_000) return 18;
  if (pixels > 1_200_000) return 24;
  return 30;
}

export function parseSize(value: string): { width: number; height: number } {
  const preset = SIZE_PRESETS[value];
  if (preset) return preset;
  const match = value.match(/^(\d+)x(\d+)$/);
  if (!match) throw new Error(`Invalid size "${value}" — use WxH or one of: ${Object.keys(SIZE_PRESETS).join(', ')}`);
  return { width: Number.parseInt(match[1], 10), height: Number.parseInt(match[2], 10) };
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layout {
  W: number;
  H: number;
  mode: LayoutMode;
  browser: Box;
  terminal: Box;
  windowBar: number;
  radius: number;
  vhsWidth: number;
  vhsHeight: number;
  vhsFramerate: number;
  fontSize: number;
  lineHeight: number;
  cols: number;
  rows: number;
  shadows: boolean;
}

type LayoutMode = 'wide' | 'square' | 'tall';

interface Boxes {
  browser: Box;
  terminal: Box;
  barH: number;
  canvasW?: number;
}
