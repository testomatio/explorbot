#!/usr/bin/env bun
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const MAX_OUTPUT = 5000;
const MAX_OUTER_HTML = 300;

const htmlFile = process.argv[2];
const xpathExpr = process.argv[3];

if (!htmlFile || !xpathExpr) {
  console.error('Usage: bun xpath-query.ts <html-file> <xpath-expression>');
  process.exit(2);
}

let html: string;
try {
  html = readFileSync(htmlFile, 'utf-8');
} catch {
  console.error(`Cannot read file: ${htmlFile}`);
  process.exit(2);
}

const dom = new JSDOM(html);
const document = dom.window.document;

let results: Node[];
try {
  const xpathResult = document.evaluate(
    xpathExpr,
    document,
    null,
    7, // ORDERED_NODE_SNAPSHOT_TYPE
    null
  );
  results = [];
  for (let i = 0; i < xpathResult.snapshotLength; i++) {
    results.push(xpathResult.snapshotItem(i)!);
  }
} catch (e: any) {
  console.error(`Invalid XPath: ${e.message}`);
  process.exit(2);
}

if (!results.length) {
  console.log('No elements found.');
  console.log('\nSuggestions:');
  console.log('  - Try a broader expression like //* or //button');
  console.log('  - Check for typos in attribute names');
  console.log('  - Use contains() for partial matches: //*[contains(@class, "btn")]');
  process.exit(1);
}

function getKeyAttrs(el: Element): string {
  const attrs = ['role', 'aria-label', 'id', 'name', 'type', 'href', 'class'];
  const parts: string[] = [];
  for (const attr of attrs) {
    const val = el.getAttribute(attr);
    if (!val) continue;
    const display = val.length > 60 ? `${val.slice(0, 57)}...` : val;
    parts.push(`${attr}="${display}"`);
  }
  return parts.join(' ');
}

function semanticAttrs(el: Element): string {
  const parts: string[] = [];
  const SEMANTIC = ['role', 'aria-label', 'aria-describedby', 'aria-expanded', 'aria-haspopup', 'name', 'type', 'href', 'for', 'action', 'method'];
  for (const attr of SEMANTIC) {
    const val = el.getAttribute(attr);
    if (!val) continue;
    const display = val.length > 40 ? `${val.slice(0, 37)}...` : val;
    parts.push(`[${attr}="${display}"]`);
  }
  for (const attr of el.getAttributeNames()) {
    if (!attr.startsWith('data-')) continue;
    const val = el.getAttribute(attr)!;
    const display = val.length > 30 ? `${val.slice(0, 27)}...` : val;
    parts.push(`[${attr}="${display}"]`);
  }
  return parts.join('');
}

function elementSelector(el: Element): string {
  const tag = el.tagName?.toLowerCase() || '?';
  if (tag === 'html' || tag === 'body') return tag;
  let sel = tag;
  const id = el.getAttribute('id');
  if (id) sel += `#${id}`;
  const cls = el.getAttribute('class');
  if (cls) {
    const classes = cls.trim().split(/\s+/).slice(0, 3);
    sel += `.${classes.join('.')}`;
    if (cls.trim().split(/\s+/).length > 3) sel += '...';
  }
  sel += semanticAttrs(el);
  return sel;
}

function buildPath(el: Element): string {
  const chain: string[] = [];
  let current: Element | null = el;
  while (current) {
    const tag = current.tagName?.toLowerCase();
    if (!tag) break;
    chain.unshift(elementSelector(current));
    if (tag === 'body') break;
    current = current.parentElement;
  }
  return chain.join(' > ');
}

function siblingInfo(el: Element): string {
  const parts: string[] = [];
  const prev = el.previousElementSibling;
  const next = el.nextElementSibling;
  if (prev) parts.push(`prev: <${prev.tagName?.toLowerCase()}>`);
  if (next) parts.push(`next: <${next.tagName?.toLowerCase()}>`);
  return parts.join(', ') || 'none';
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return `${str.slice(0, max)}... (truncated)`;
}

let output = `Found ${results.length} element(s) matching: ${xpathExpr}\n\n`;

for (let i = 0; i < results.length; i++) {
  const node = results[i];
  if (!(node as Element).tagName) continue;

  const el = node as Element;
  const tag = el.tagName?.toLowerCase() || '?';
  const attrs = getKeyAttrs(el);
  const outerHTML = truncate((el.outerHTML || '').replace(/\s+/g, ' ').trim(), MAX_OUTER_HTML);
  const path = buildPath(el);
  const siblings = siblingInfo(el);

  const entry = [`--- [${i + 1}] <${tag}> ${attrs}`, `    outerHTML: ${outerHTML}`, `    path:     ${path}`, `    siblings: ${siblings}`].join('\n');

  if (output.length + entry.length > MAX_OUTPUT) {
    output += `\n... (${results.length - i} more elements truncated)\n`;
    break;
  }

  output += `${entry}\n\n`;
}

console.log(output.trimEnd());
