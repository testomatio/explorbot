import { Buffer } from 'node:buffer';

const metaCharRe = /^[a-zA-Z0-9]$/;
const fnKeyRe = /^(O|N|\[|\[\[)(?:(\d+)(?:;(\d+))?([~^$])|(?:1;)?(\d+)?([a-zA-Z]))/;

const keyName: Record<string, string> = {
  OP: 'f1',
  OQ: 'f2',
  OR: 'f3',
  OS: 'f4',
  '[11~': 'f1',
  '[12~': 'f2',
  '[13~': 'f3',
  '[14~': 'f4',
  '[[A': 'f1',
  '[[B': 'f2',
  '[[C': 'f3',
  '[[D': 'f4',
  '[[E': 'f5',
  '[15~': 'f5',
  '[17~': 'f6',
  '[18~': 'f7',
  '[19~': 'f8',
  '[20~': 'f9',
  '[21~': 'f10',
  '[23~': 'f11',
  '[24~': 'f12',
  '[A': 'up',
  '[B': 'down',
  '[C': 'right',
  '[D': 'left',
  '[E': 'clear',
  '[F': 'end',
  '[H': 'home',
  OA: 'up',
  OB: 'down',
  OC: 'right',
  OD: 'left',
  OE: 'clear',
  OF: 'end',
  OH: 'home',
  '[1~': 'home',
  '[2~': 'insert',
  '[3~': 'delete',
  '[4~': 'end',
  '[5~': 'pageup',
  '[6~': 'pagedown',
  '[[5~': 'pageup',
  '[[6~': 'pagedown',
  '[7~': 'home',
  '[8~': 'end',
  '[a': 'up',
  '[b': 'down',
  '[c': 'right',
  '[d': 'left',
  '[e': 'clear',
  '[2$': 'insert',
  '[3$': 'delete',
  '[5$': 'pageup',
  '[6$': 'pagedown',
  '[7$': 'home',
  '[8$': 'end',
  Oa: 'up',
  Ob: 'down',
  Oc: 'right',
  Od: 'left',
  Oe: 'clear',
  '[2^': 'insert',
  '[3^': 'delete',
  '[5^': 'pageup',
  '[6^': 'pagedown',
  '[7^': 'home',
  '[8^': 'end',
  '[Z': 'tab',
};

export const nonAlphanumericKeys = [...Object.values(keyName), 'backspace'];

const isShiftKey = (code: string) => ['[a', '[b', '[c', '[d', '[e', '[2$', '[3$', '[5$', '[6$', '[7$', '[8$', '[Z'].includes(code);

const isCtrlKey = (code: string) => ['Oa', 'Ob', 'Oc', 'Od', 'Oe', '[2^', '[3^', '[5^', '[6^', '[7^', '[8^'].includes(code);

export default function parseKeypress(value: string | Buffer = '') {
  let parts: RegExpExecArray | null;
  let sequence = value;

  if (Buffer.isBuffer(sequence)) {
    if (sequence[0] > 127 && sequence[1] === undefined) {
      sequence[0] -= 128;
      sequence = `\x1b${String(sequence)}`;
    } else {
      sequence = String(sequence);
    }
  } else if (sequence !== undefined && typeof sequence !== 'string') {
    sequence = String(sequence);
  } else if (!sequence) {
    sequence = '';
  }

  const key = {
    name: '',
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    sequence,
    raw: sequence as string | undefined,
    code: undefined as string | undefined,
  };

  if (sequence === '\r') {
    key.raw = undefined;
    key.name = 'return';
  } else if (sequence === '\n') {
    key.name = 'enter';
  } else if (sequence === '\t') {
    key.name = 'tab';
  } else if (sequence === '\b' || sequence === '\x1b\b') {
    key.name = 'backspace';
    key.meta = sequence.charAt(0) === '\x1b';
  } else if (sequence === '\x7f' || sequence === '\x1b\x7f') {
    key.name = 'backspace';
    key.meta = sequence.charAt(0) === '\x1b';
  } else if (sequence === '\x1b' || sequence === '\x1b\x1b') {
    key.name = 'escape';
    key.meta = sequence.length === 2;
  } else if (sequence === ' ' || sequence === '\x1b ') {
    key.name = 'space';
    key.meta = sequence.length === 2;
  } else if (sequence.length === 1 && sequence <= '\x1a') {
    key.name = String.fromCharCode(sequence.charCodeAt(0) + 'a'.charCodeAt(0) - 1);
    key.ctrl = true;
  } else if (sequence.length === 1 && sequence >= '0' && sequence <= '9') {
    key.name = 'number';
  } else if (sequence.length === 1 && sequence >= 'a' && sequence <= 'z') {
    key.name = sequence;
  } else if (sequence.length === 1 && sequence >= 'A' && sequence <= 'Z') {
    key.name = sequence.toLowerCase();
    key.shift = true;
  } else if (sequence.startsWith('\x1b') && sequence.length === 2 && metaCharRe.test(sequence[1] || '')) {
    key.meta = true;
    key.shift = /^[A-Z]$/.test(sequence[1] || '');
  } else {
    let escapePrefixLength = 0;
    while (sequence[escapePrefixLength] === '\x1b') {
      escapePrefixLength += 1;
    }
    const sequenceBody = sequence.slice(escapePrefixLength);
    parts = fnKeyRe.exec(sequenceBody);
    if (!parts) {
      return key;
    }

    if (escapePrefixLength > 1) {
      key.option = true;
    }

    const code = [parts[1], parts[2], parts[4], parts[6]].filter(Boolean).join('');
    const modifier = Number(parts[3] || parts[5] || 1) - 1;
    key.ctrl = Boolean(modifier & 4);
    key.meta = Boolean(modifier & 10);
    key.shift = Boolean(modifier & 1);
    key.code = code;
    key.name = keyName[code] || '';
    key.shift = isShiftKey(code) || key.shift;
    key.ctrl = isCtrlKey(code) || key.ctrl;
  }

  return key;
}
