import { parse as parseYaml } from 'yaml';

// ─────────────────────────────────────────────────────────────────
// Roles
// ─────────────────────────────────────────────────────────────────

const INTERACTIVE_ROLES = new Set(
  [
    'button',
    'link',
    'textbox',
    'searchbox',
    'checkbox',
    'radio',
    'radiogroup',
    'switch',
    'combobox',
    'listbox',
    'listitem',
    'menu',
    'menubar',
    'menuitem',
    'menuitemcheckbox',
    'menuitemradio',
    'option',
    'tab',
    'tabpanel',
    'tablist',
    'slider',
    'spinbutton',
    'tree',
    'treeitem',
    'grid',
    'gridcell',
    'row',
    'rowheader',
    'columnheader',
    'toolbar',
    'progressbar',
    'buttonmenu',
    'comboboxbutton',
    'gridcellbutton',
  ].map((role) => role.toLowerCase())
);

const IGNORED_ROLES = new Set(['navigation']);

// ─────────────────────────────────────────────────────────────────
// Tunables (knobs that change pipeline behavior)
// ─────────────────────────────────────────────────────────────────

const SIBLING_COLLAPSE_THRESHOLD = 50;
const SIBLING_COLLAPSE_KEEP_EACH_SIDE = 5;

// ─────────────────────────────────────────────────────────────────
// STEP 1 · Parse: YAML text → AriaNode[]
// ─────────────────────────────────────────────────────────────────

const normalizeScalar = (input: string): string | boolean | null => {
  let value = input.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  const lower = value.toLowerCase();
  if (lower === 'true') return true;
  if (lower === 'false') return false;
  if (lower === 'null') return null;
  return value;
};

// Parse one YAML node label like:  `button "Save"`,  `textbox "Email" [focused]`,  `heading "Title" [level=2]`
const parseLabel = (label: string): { role: string; name?: string; attributes: Record<string, string | boolean | null> } | null => {
  if (!label) return null;
  const trimmed = label.trim();
  const roleMatch = trimmed.match(/^(\w+)/);
  if (!roleMatch) return null;
  const role = roleMatch[1].toLowerCase();
  let rest = trimmed.slice(roleMatch[0].length);

  let name: string | undefined;
  const nameMatch = rest.match(/^\s*"((?:[^"\\]|\\.)*)"/) || rest.match(/^\s*'((?:[^'\\]|\\.)*)'/);
  if (nameMatch) {
    name = nameMatch[1];
    rest = rest.slice(nameMatch[0].length);
  }

  const attributes: Record<string, string | boolean | null> = {};
  const attrMatch = rest.match(/\[([^\]]*)\]/);
  if (attrMatch) {
    for (const tok of attrMatch[1].split(/[\s,]+/).filter(Boolean)) {
      const eq = tok.indexOf('=');
      if (eq === -1) {
        attributes[tok.toLowerCase()] = true;
        continue;
      }
      attributes[tok.slice(0, eq).trim().toLowerCase()] = normalizeScalar(tok.slice(eq + 1));
    }
  }

  return { role, name, attributes };
};

const yamlItemToNode = (item: unknown): AriaNode | null => {
  if (typeof item === 'string') {
    const label = parseLabel(item);
    if (!label) return null;
    const node: AriaNode = { role: label.role, attributes: label.attributes, children: [] };
    if (label.name && label.name.trim() !== '') node.name = label.name.trim();
    return node;
  }
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;

  const entries = Object.entries(item as Record<string, unknown>);
  if (entries.length === 0) return null;
  const [key, value] = entries[0];
  const label = parseLabel(key);
  if (!label) return null;
  const node: AriaNode = { role: label.role, attributes: label.attributes, children: [] };
  if (label.name && label.name.trim() !== '') node.name = label.name.trim();

  if (Array.isArray(value)) {
    node.children = value.map(yamlItemToNode).filter((n): n is AriaNode => n !== null);
    return node;
  }
  if (value === null || value === undefined) return node;
  const normalized = normalizeScalar(String(value));
  if (normalized !== '' && normalized !== undefined) node.value = normalized;
  return node;
};

const parseSnapshot = (snapshot: string | null): AriaNode[] => {
  if (!snapshot) return [];
  let parsed: unknown;
  try {
    parsed = parseYaml(snapshot);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map(yamlItemToNode).filter((n): n is AriaNode => n !== null);
};

// ─────────────────────────────────────────────────────────────────
// STEP 2 · Transforms: AriaNode[] → AriaNode[]
//   Each is a pure function. Compose by stacking calls in the public API.
// ─────────────────────────────────────────────────────────────────

// Dissolve <navigation> wrappers into their children.
const unwrapIgnored = (nodes: AriaNode[]): AriaNode[] =>
  nodes.flatMap((node) => {
    const children = unwrapIgnored(node.children);
    if (IGNORED_ROLES.has(node.role)) return children;
    return [{ ...node, children }];
  });

// Walk children to produce a synthetic label for naming icon-only buttons.
const summarizeChildren = (children: AriaNode[]): string =>
  children
    .map((child) => {
      let part = child.role;
      if (child.name) part += ` "${child.name}"`;
      const nested = summarizeChildren(child.children);
      if (nested) part += ` > ${nested}`;
      return part;
    })
    .join(', ');

// Set node.name = "{img "icon"}" for buttons/links that have no name but do have children.
// Recurses so nested buttons get named too. Uses ORIGINAL children for the summary, before pruning.
const nameIconButtons = (nodes: AriaNode[]): AriaNode[] =>
  nodes.map((node) => {
    const namedChildren = nameIconButtons(node.children);
    if (node.name) return { ...node, children: namedChildren };
    if (node.role !== 'button' && node.role !== 'link') return { ...node, children: namedChildren };
    if (node.children.length === 0) return { ...node, children: namedChildren };
    return { ...node, name: `{${summarizeChildren(node.children)}}`, children: namedChildren };
  });

// Drop containers that contribute nothing.
//   keepNamed=true → also keep named non-interactive nodes (e.g. headings, named text).
const dropEmpty = (nodes: AriaNode[], opts: { keepNamed?: boolean } = {}): AriaNode[] =>
  nodes.flatMap((node) => {
    const children = dropEmpty(node.children, opts);
    if (INTERACTIVE_ROLES.has(node.role)) return [{ ...node, children }];
    if (children.length > 0) return [{ ...node, children }];
    if (opts.keepNamed && (node.name || node.value !== undefined)) return [{ ...node, children }];
    return [];
  });

// ─────────────────────────────────────────────────────────────────
// STEP 3 · Render: AriaNode[] → text or flat entries
// ─────────────────────────────────────────────────────────────────

// One-line representation of a node. Stable attr order so diff comparisons are deterministic.
const formatNode = (node: AriaNode): string => {
  let line = node.role;
  if (node.name?.trim()) line += ` "${node.name.trim()}"`;
  const attrStr = Object.keys(node.attributes)
    .sort()
    .map((k) => {
      const v = node.attributes[k];
      if (v === undefined || v === null || v === '') return '';
      if (v === true) return k;
      return `${k}=${v}`;
    })
    .filter(Boolean)
    .join(' ');
  if (attrStr) line += ` [${attrStr}]`;
  if (node.value !== undefined && node.value !== null) {
    const text = String(node.value).trim();
    if (text) line += `: ${text}`;
  }
  return line;
};

// Group consecutive same-role siblings.  [a,a,b,a,a,a] → [[a,a],[b],[a,a,a]]
const groupByConsecutiveRole = (nodes: AriaNode[]): AriaNode[][] =>
  nodes.reduce<AriaNode[][]>((groups, node) => {
    const last = groups[groups.length - 1];
    if (last && last[0].role === node.role) {
      last.push(node);
      return groups;
    }
    groups.push([node]);
    return groups;
  }, []);

// Large group of same-role siblings → first N + "...M omitted..." marker + last N.
const collapseGroup = (group: AriaNode[], depth: number): RenderEntry[] => {
  if (group.length <= SIBLING_COLLAPSE_THRESHOLD) {
    return group.map((node) => ({ node }));
  }
  const keep = SIBLING_COLLAPSE_KEEP_EACH_SIDE;
  const omitted = group.length - keep * 2;
  const indent = '  '.repeat(depth);
  return [...group.slice(0, keep).map((node) => ({ node })), { placeholder: `${indent}- ...${omitted} similar "${group[0].role}" items omitted...` }, ...group.slice(-keep).map((node) => ({ node }))];
};

const collapseSiblingGroups = (nodes: AriaNode[], depth: number): RenderEntry[] => groupByConsecutiveRole(nodes).flatMap((group) => collapseGroup(group, depth));

// Tree → indented YAML text.
const renderTree = (nodes: AriaNode[], depth = 0): string =>
  collapseSiblingGroups(nodes, depth)
    .map((entry) => {
      if ('placeholder' in entry) return entry.placeholder;
      const { node } = entry;
      const indent = '  '.repeat(depth);
      const head = `${indent}- ${formatNode(node)}`;
      if (node.children.length === 0) return head;
      return `${head}:\n${renderTree(node.children, depth + 1)}`;
    })
    .join('\n');

// Build the structured "entry" object for an interactive node, or null if not worth keeping.
const nodeToEntry = (node: AriaNode): Record<string, unknown> | null => {
  if (!INTERACTIVE_ROLES.has(node.role)) return null;
  const entry: Record<string, unknown> = { role: node.role };
  if (node.name?.trim()) entry.name = node.name.trim();
  if (node.value !== undefined && node.value !== null) {
    const text = String(node.value).trim();
    if (text) entry.value = node.value;
  }
  for (const [key, value] of Object.entries(node.attributes)) {
    if (value === undefined || value === null || value === '') continue;
    entry[key] = value;
  }
  const isButtonOrLink = node.role === 'button' || node.role === 'link';
  const hasContent = Object.keys(entry).length > 1;
  if (isButtonOrLink && !hasContent) {
    entry.unnamed = true;
    return entry;
  }
  if (!hasContent) return null;
  return entry;
};

// Walk tree, emit one FlatEntry per interactive node. Path is dotted index from root.
const flatten = (nodes: AriaNode[]): FlatEntry[] => {
  const collect = (node: AriaNode, path: string): FlatEntry[] => {
    const entry = nodeToEntry(node);
    const here: FlatEntry[] = entry ? [{ path, summary: formatNode(node), entry }] : [];
    const fromChildren = node.children.flatMap((child, i) => collect(child, `${path}.${i}`));
    return [...here, ...fromChildren];
  };
  return nodes.flatMap((node, i) => collect(node, String(i)));
};

// ─────────────────────────────────────────────────────────────────
// STEP 4 · Diff: FlatEntry[] × FlatEntry[] → text
// ─────────────────────────────────────────────────────────────────

const countBy = (items: string[]): Map<string, number> =>
  items.reduce((map, item) => {
    if (item === '') return map;
    map.set(item, (map.get(item) ?? 0) + 1);
    return map;
  }, new Map<string, number>());

// Bag-style diff: any summary appearing more in one bag than the other becomes added/removed.
const diffByCount = (before: Map<string, number>, after: Map<string, number>): { added: string[]; removed: string[] } => {
  const added: string[] = [];
  const removed: string[] = [];
  const all = new Set<string>([...before.keys(), ...after.keys()]);
  for (const summary of all) {
    const b = before.get(summary) ?? 0;
    const a = after.get(summary) ?? 0;
    for (let i = 0; i < a - b; i += 1) added.push(summary);
    for (let i = 0; i < b - a; i += 1) removed.push(summary);
  }
  return { added, removed };
};

// When the same path has a different summary AND the per-summary totals haven't shifted,
// treat it as a rename (one add + one remove). Catches "button text changed" cases that
// the count-based diff would miss.
const detectRenames = (prev: FlatEntry[], curr: FlatEntry[], prevTotals: Map<string, number>, currTotals: Map<string, number>): { added: string[]; removed: string[] } => {
  const added: string[] = [];
  const removed: string[] = [];
  const prevByPath = new Map(prev.map((e) => [e.path, e.summary]));
  const currByPath = new Map(curr.map((e) => [e.path, e.summary]));

  for (const [path, beforeSummary] of prevByPath) {
    const afterSummary = currByPath.get(path);
    if (!afterSummary || afterSummary === beforeSummary) continue;
    const totalsAfter = (currTotals.get(afterSummary) ?? 0) === (prevTotals.get(afterSummary) ?? 0);
    const totalsBefore = (currTotals.get(beforeSummary) ?? 0) === (prevTotals.get(beforeSummary) ?? 0);
    if (!totalsAfter || !totalsBefore) continue;
    const beforeElsewhere = curr.some((e) => e.path !== path && e.summary === beforeSummary);
    const afterElsewhere = prev.some((e) => e.path !== path && e.summary === afterSummary);
    if (beforeElsewhere && afterElsewhere) continue;
    added.push(afterSummary);
    removed.push(beforeSummary);
  }
  return { added, removed };
};

const TOP_DIFF_ITEMS = 10;

const formatDiffSection = (label: string, items: string[]): string[] => {
  const summary = countBy(items);
  if (summary.size === 0) return [`  ${label}: []`];

  const sorted = Array.from(summary.entries()).sort(([aItem, aCount], [bItem, bCount]) => bCount - aCount || aItem.localeCompare(bItem));
  const top = sorted.slice(0, TOP_DIFF_ITEMS);
  const rest = sorted.slice(TOP_DIFF_ITEMS);

  const lines = [`  ${label}:`];
  for (const [item, count] of top) {
    let suffix = '';
    if (count > 1) suffix = ` (x${count})`;
    lines.push(`    - ${item}${suffix}`);
  }
  if (rest.length > 0) {
    let restTotal = 0;
    for (const [, count] of rest) restTotal += count;
    lines.push(`    + ${restTotal} more interactive elements`);
  }
  return lines;
};

const formatDiff = (added: string[], removed: string[]): string | null => {
  if (added.length === 0 && removed.length === 0) return null;
  return ['ariaDiff:', ...formatDiffSection('added', added), ...formatDiffSection('removed', removed)].join('\n');
};

// ─────────────────────────────────────────────────────────────────
// Focus area detection (separate concern; consumes pipeline output)
// ─────────────────────────────────────────────────────────────────

export interface FocusAreaResult {
  detected: boolean;
  type: 'dialog' | 'modal' | null;
  name: string | null;
}

const CLOSE_OVERLAY_BUTTON_RE = /^close\s+(modal|dialog|popup|drawer|panel|sheet)\b/i;

const findOverlayByCloseButton = (nodeList: AriaNode[]): FocusAreaResult | null => {
  const closeIdx = nodeList.findIndex((n) => n.role === 'button' && CLOSE_OVERLAY_BUTTON_RE.test(n.name || ''));
  if (closeIdx !== -1) {
    let heading: AriaNode | undefined;
    for (let i = closeIdx - 1; i >= 0; i--) {
      if (nodeList[i].role === 'heading' && nodeList[i].name) {
        heading = nodeList[i];
        break;
      }
    }
    if (!heading) {
      for (let i = closeIdx + 1; i < nodeList.length; i++) {
        if (nodeList[i].role === 'heading' && nodeList[i].name) {
          heading = nodeList[i];
          break;
        }
      }
    }
    return { detected: true, type: 'dialog', name: heading?.name || null };
  }
  for (const node of nodeList) {
    const inner = findOverlayByCloseButton(node.children);
    if (inner) return inner;
  }
  return null;
};

const findDialogOrModal = (nodes: AriaNode[]): FocusAreaResult | null => {
  for (const node of nodes) {
    if (node.role === 'dialog' || node.role === 'alertdialog') {
      return { detected: true, type: 'dialog', name: node.name || null };
    }
    if (node.attributes.modal === true || node.attributes.modal === 'true') {
      return { detected: true, type: 'modal', name: node.name || null };
    }
    const child = findDialogOrModal(node.children);
    if (child) return child;
  }
  return null;
};

// ─────────────────────────────────────────────────────────────────
// Public API — pipelines composed visibly, top-to-bottom
// ─────────────────────────────────────────────────────────────────

export const compactAriaSnapshot = (snapshot: string | null, keepNamed = false): string => {
  if (!snapshot) return '';
  let tree = parseSnapshot(snapshot);
  tree = unwrapIgnored(tree);
  tree = nameIconButtons(tree);
  tree = dropEmpty(tree, { keepNamed });
  return renderTree(tree);
};

export const diffAriaSnapshots = (previous: string | null, current: string | null): string | null => {
  const flat = (snap: string | null): FlatEntry[] => {
    let tree = parseSnapshot(snap);
    tree = unwrapIgnored(tree);
    tree = nameIconButtons(tree);
    tree = dropEmpty(tree);
    return flatten(tree);
  };
  const prev = flat(previous);
  const curr = flat(current);
  const prevTotals = countBy(prev.map((e) => e.summary));
  const currTotals = countBy(curr.map((e) => e.summary));
  const byCount = diffByCount(prevTotals, currTotals);
  const renames = detectRenames(prev, curr, prevTotals, currTotals);
  return formatDiff([...byCount.added, ...renames.added], [...byCount.removed, ...renames.removed]);
};

export const detectFocusArea = (snapshot: string | null): FocusAreaResult => {
  let tree = parseSnapshot(snapshot);
  tree = unwrapIgnored(tree);
  tree = dropEmpty(tree, { keepNamed: true });

  const direct = findDialogOrModal(tree);
  if (direct) return direct;

  const fallback = findOverlayByCloseButton(tree);
  if (fallback?.name) return fallback;

  return { detected: false, type: null, name: null };
};

export const collectInteractiveNodes = (snapshot: string | null): Array<Record<string, unknown>> => {
  let tree = parseSnapshot(snapshot);
  tree = unwrapIgnored(tree);
  tree = nameIconButtons(tree);
  tree = dropEmpty(tree);
  return flatten(tree).map((e) => e.entry);
};

// ─────────────────────────────────────────────────────────────────
// Standalone helpers (regex on raw strings — not part of the pipeline)
// ─────────────────────────────────────────────────────────────────

export interface FocusedElementInfo {
  role: string;
  name: string;
  value?: string;
  attributes?: string[];
}

export function extractFocusedElement(ariaSnapshot: string | null): FocusedElementInfo | null {
  if (!ariaSnapshot) return null;

  const focusedMatch = ariaSnapshot.match(/-\s*(\w+)\s+"([^"]*)"([^:\n]*)\[focused\](?::\s*(.*))?/);
  if (!focusedMatch) return null;

  const [, role, name, attributesStr, value] = focusedMatch;

  const attributes: string[] = [];
  if (attributesStr) {
    const attrMatches = attributesStr.matchAll(/\[([^\]]+)\]/g);
    for (const match of attrMatches) {
      if (match[1] !== 'focused') {
        attributes.push(match[1]);
      }
    }
  }

  const result: FocusedElementInfo = { role, name };
  if (value) result.value = value.trim();
  if (attributes.length > 0) result.attributes = attributes;
  return result;
}

export function parseAriaLocator(ariaStr: string): { role: string; text: string } | null {
  const trimmed = ariaStr.trim();
  if (trimmed === '-' || trimmed === '' || trimmed === '"-"') return null;

  const match = trimmed.match(/\{\s*["']?role["']?\s*:\s*['"]([^'"]+)['"]\s*,\s*["']?text["']?\s*:\s*['"]([^'"]*)['"]\s*\}/);
  if (!match) return null;

  return { role: match[1], text: match[2] };
}

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

type AriaNode = {
  role: string;
  name?: string;
  value?: string | boolean | null;
  attributes: Record<string, string | boolean | null>;
  children: AriaNode[];
};

type RenderEntry = { node: AriaNode } | { placeholder: string };

type FlatEntry = {
  path: string;
  summary: string;
  entry: Record<string, unknown>;
};
