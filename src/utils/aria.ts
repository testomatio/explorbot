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

const IGNORED_CONTAINER_ROLES = new Set(['navigation']);

type AriaNode = {
  role: string;
  name?: string;
  value?: string | boolean | null;
  attributes: Record<string, string | boolean | null>;
  children: AriaNode[];
};

const buildInteractiveEntry = (node: AriaNode): Record<string, unknown> | null => {
  if (!INTERACTIVE_ROLES.has(node.role)) {
    return null;
  }
  const entry: Record<string, unknown> = { role: node.role };
  if (node.name && node.name.trim() !== '') {
    entry.name = node.name.trim();
  }
  if (node.value !== undefined && node.value !== null) {
    const valueText = `${node.value}`.trim();
    if (valueText !== '') {
      entry.value = node.value;
    }
  }
  for (const [key, value] of Object.entries(node.attributes)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (value === '') {
      continue;
    }
    entry[key] = value;
  }
  const hasData = Object.keys(entry).some((key) => key !== 'role');
  const entryName = typeof entry.name === 'string' ? entry.name : '';
  const hasValue = Object.prototype.hasOwnProperty.call(entry, 'value');
  const isButtonOrLink = node.role === 'button' || node.role === 'link';
  let shouldInclude = hasData;
  if (!shouldInclude && hasValue) {
    shouldInclude = true;
  }
  if (isButtonOrLink && !entryName && !hasValue) {
    shouldInclude = false;
  }
  if (node.role === 'link' && entryName && entryName.length > 30) {
    shouldInclude = false;
  }
  if (!shouldInclude) {
    return null;
  }
  return entry;
};

const normalizeScalar = (input: string): string | boolean | null => {
  let value = input.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  const lower = value.toLowerCase();
  if (lower === 'true') {
    return true;
  }
  if (lower === 'false') {
    return false;
  }
  if (lower === 'null') {
    return null;
  }
  return value;
};

const tokenizeAttributes = (input: string): string[] => {
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if ((char === '"' || char === "'") && input[i - 1] !== '\\') {
      if (inQuotes && quoteChar === char) {
        inQuotes = false;
        quoteChar = '';
      } else if (!inQuotes) {
        inQuotes = true;
        quoteChar = char;
      }
      current += char;
      continue;
    }
    if (!inQuotes && (char === ' ' || char === ',')) {
      if (current.trim() !== '') {
        tokens.push(current.trim());
      }
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim() !== '') {
    tokens.push(current.trim());
  }
  return tokens;
};

const parseAttributes = (input: string): Record<string, string | boolean | null> => {
  const attributes: Record<string, string | boolean | null> = {};
  const tokens = tokenizeAttributes(input);
  for (const token of tokens) {
    if (token === '') {
      continue;
    }
    const separatorIndex = token.indexOf('=');
    if (separatorIndex === -1) {
      attributes[token.toLowerCase()] = true;
      continue;
    }
    const key = token.slice(0, separatorIndex).trim().toLowerCase();
    const valueRaw = token.slice(separatorIndex + 1).trim();
    attributes[key] = normalizeScalar(valueRaw);
  }
  return attributes;
};

const parseHeader = (header: string): { role: string; name?: string; attributes: Record<string, string | boolean | null> } | null => {
  if (!header) {
    return null;
  }
  let index = 0;
  const length = header.length;
  while (index < length && header[index] === ' ') {
    index += 1;
  }
  let roleEnd = index;
  while (roleEnd < length) {
    const char = header[roleEnd];
    if (char === ' ' || char === '[' || char === '"' || char === "'") {
      break;
    }
    roleEnd += 1;
  }
  const role = header.slice(index, roleEnd).trim().toLowerCase();
  if (!role) {
    return null;
  }
  let name: string | undefined;
  const attributes: Record<string, string | boolean | null> = {};
  index = roleEnd;
  while (index < length) {
    const char = header[index];
    if (char === ' ') {
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      const quoteChar = char;
      index += 1;
      let value = '';
      while (index < length) {
        const currentChar = header[index];
        if (currentChar === quoteChar && header[index - 1] !== '\\') {
          index += 1;
          break;
        }
        value += currentChar;
        index += 1;
      }
      if (!name) {
        name = value;
      }
      continue;
    }
    if (char === '[') {
      const end = header.indexOf(']', index);
      const content = end === -1 ? header.slice(index + 1) : header.slice(index + 1, end);
      const parsed = parseAttributes(content);
      for (const [key, value] of Object.entries(parsed)) {
        attributes[key] = value;
      }
      index = end === -1 ? length : end + 1;
      continue;
    }
    break;
  }
  return { role, name, attributes };
};

const splitHeaderValue = (content: string): { header: string; value: string | null } => {
  let activeQuote: string | null = null;
  let bracketDepth = 0;
  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    if ((char === '"' || char === "'") && content[i - 1] !== '\\') {
      if (activeQuote === char) {
        activeQuote = null;
      } else if (!activeQuote) {
        activeQuote = char;
      }
      continue;
    }
    if (!activeQuote) {
      if (char === '[') {
        bracketDepth += 1;
        continue;
      }
      if (char === ']') {
        if (bracketDepth > 0) {
          bracketDepth -= 1;
        }
        continue;
      }
      if (char === ':') {
        if (bracketDepth === 0) {
          const header = content.slice(0, i).trimEnd();
          const value = content.slice(i + 1).trimStart();
          return { header, value: value === '' ? null : value };
        }
      }
    }
  }
  return { header: content.trim(), value: null };
};

const pruneNodes = (nodes: AriaNode[]): AriaNode[] => {
  const result: AriaNode[] = [];
  for (const node of nodes) {
    const children = pruneNodes(node.children);
    if (IGNORED_CONTAINER_ROLES.has(node.role)) {
      result.push(...children);
      continue;
    }
    const interactive = INTERACTIVE_ROLES.has(node.role);
    if (!interactive && children.length === 0) {
      continue;
    }
    result.push({ ...node, children });
  }
  return result;
};

const parseAriaSnapshot = (snapshot: string | null): AriaNode[] => {
  if (!snapshot) {
    return [];
  }
  const roots: AriaNode[] = [];
  const stack: Array<{ depth: number; node: AriaNode }> = [];
  const lines = snapshot.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    const indentMatch = line.match(/^\s*/);
    const indent = indentMatch ? indentMatch[0].length : 0;
    const trimmed = line.slice(indent);
    if (!trimmed.startsWith('-')) {
      continue;
    }
    const content = trimmed.slice(1).trim();
    if (content === '') {
      continue;
    }
    const { header, value } = splitHeaderValue(content);
    const parsedHeader = parseHeader(header);
    if (!parsedHeader) {
      continue;
    }
    const node: AriaNode = {
      role: parsedHeader.role,
      attributes: { ...parsedHeader.attributes },
      children: [],
    };
    if (parsedHeader.name && parsedHeader.name.trim() !== '') {
      node.name = parsedHeader.name.trim();
    }
    if (value !== null) {
      const normalizedValue = normalizeScalar(value);
      if (normalizedValue !== '' && normalizedValue !== undefined) {
        node.value = normalizedValue;
      }
    }
    const depth = Math.floor(indent / 2);
    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
      stack.pop();
    }
    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].node.children.push(node);
    }
    stack.push({ depth, node });
  }
  return pruneNodes(roots);
};

export const collectInteractiveNodes = (snapshot: string | null): Array<Record<string, unknown>> => {
  const nodes = parseAriaSnapshot(snapshot);
  const result: Array<Record<string, unknown>> = [];
  const visit = (node: AriaNode) => {
    if (IGNORED_CONTAINER_ROLES.has(node.role)) {
      node.children.forEach(visit);
      return;
    }
    const entry = buildInteractiveEntry(node);
    if (entry) {
      result.push(entry);
    }
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return result;
};

const formatSummary = (node: Record<string, unknown>): string => {
  const role = typeof node.role === 'string' ? node.role : '';
  if (!role) {
    return '';
  }
  const name = typeof node.name === 'string' && node.name.trim() !== '' ? `"${node.name.trim()}"` : '';
  const attributeKeys = Object.keys(node)
    .filter((key) => key !== 'role' && key !== 'name' && key !== 'value')
    .sort();
  const attributes = attributeKeys.map((key) => {
    const value = node[key];
    if (value === true) {
      return key;
    }
    return `${key}=${value}`;
  });
  const attributeText = attributes.length > 0 ? `[${attributes.join(' ')}]` : '';
  let valueText: string | null = null;
  if (Object.prototype.hasOwnProperty.call(node, 'value')) {
    const raw = node.value as unknown;
    if (raw !== null && raw !== undefined) {
      const text = `${raw}`.trim();
      if (text !== '') {
        valueText = text;
      }
    }
  }
  const parts = [role];
  if (name) {
    parts.push(name);
  }
  if (attributeText) {
    parts.push(attributeText);
  }
  let line = parts.join(' ').trim();
  if (valueText !== null) {
    line = `${line}: ${valueText}`;
  }
  return line;
};

export const summarizeInteractiveNodes = (snapshot: string | null): string[] => {
  if (!snapshot) {
    return [];
  }
  const nodes = collectInteractiveNodes(snapshot);
  return nodes.map((node) => formatSummary(node)).filter((line) => line !== '');
};

type FlatInteractiveNode = {
  path: string;
  summary: string;
};

const flattenInteractiveNodes = (snapshot: string | null): FlatInteractiveNode[] => {
  const nodes = parseAriaSnapshot(snapshot);
  const result: FlatInteractiveNode[] = [];
  const visit = (node: AriaNode, path: string) => {
    if (!IGNORED_CONTAINER_ROLES.has(node.role)) {
      const entry = buildInteractiveEntry(node);
      if (entry) {
        const summary = formatSummary(entry);
        if (summary !== '') {
          result.push({ path, summary });
        }
      }
    }
    node.children.forEach((child, index) => {
      const childPath = path === '' ? `${index}` : `${path}.${index}`;
      visit(child, childPath);
    });
  };
  nodes.forEach((node, index) => {
    visit(node, `${index}`);
  });
  return result;
};

const buildCountMap = (items: string[]): Map<string, number> => {
  const map = new Map<string, number>();
  for (const item of items) {
    if (item === '') {
      continue;
    }
    map.set(item, (map.get(item) ?? 0) + 1);
  }
  return map;
};

const formatDiffItem = (item: string, count: number): string => {
  if (count > 1) {
    return `${item} (x${count})`;
  }
  return item;
};

export const diffAriaSnapshots = (previous: string | null, current: string | null): string | null => {
  const previousEntries = flattenInteractiveNodes(previous);
  const currentEntries = flattenInteractiveNodes(current);
  const previousTotals = buildCountMap(previousEntries.map((entry) => entry.summary));
  const currentTotals = buildCountMap(currentEntries.map((entry) => entry.summary));
  const added: string[] = [];
  const removed: string[] = [];
  const allSummaries = new Set<string>([...previousTotals.keys(), ...currentTotals.keys()]);
  for (const summary of allSummaries) {
    const before = previousTotals.get(summary) ?? 0;
    const after = currentTotals.get(summary) ?? 0;
    if (after > before) {
      for (let i = 0; i < after - before; i += 1) {
        added.push(summary);
      }
    }
    if (before > after) {
      for (let i = 0; i < before - after; i += 1) {
        removed.push(summary);
      }
    }
  }
  const previousByPath = new Map<string, string>();
  for (const entry of previousEntries) {
    previousByPath.set(entry.path, entry.summary);
  }
  const currentByPath = new Map<string, string>();
  for (const entry of currentEntries) {
    currentByPath.set(entry.path, entry.summary);
  }
  for (const [path, beforeSummary] of previousByPath.entries()) {
    const afterSummary = currentByPath.get(path);
    if (!afterSummary || afterSummary === beforeSummary) {
      continue;
    }
    const totalsEqualAfter = (currentTotals.get(afterSummary) ?? 0) === (previousTotals.get(afterSummary) ?? 0);
    const totalsEqualBefore = (currentTotals.get(beforeSummary) ?? 0) === (previousTotals.get(beforeSummary) ?? 0);
    if (!totalsEqualAfter || !totalsEqualBefore) {
      continue;
    }
    const beforeExistsElsewhere = currentEntries.some((entry) => entry.path !== path && entry.summary === beforeSummary);
    const afterExistsElsewhere = previousEntries.some((entry) => entry.path !== path && entry.summary === afterSummary);
    if (beforeExistsElsewhere && afterExistsElsewhere) {
      continue;
    }
    added.push(afterSummary);
    removed.push(beforeSummary);
  }
  if (added.length === 0 && removed.length === 0) {
    return null;
  }
  const lines: string[] = ['ariaDiff:'];
  const addedSummary = buildCountMap(added);
  if (addedSummary.size === 0) {
    lines.push('  added: []');
  } else {
    lines.push('  added:');
    Array.from(addedSummary.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([item, count]) => {
        lines.push(`    - ${formatDiffItem(item, count)}`);
      });
  }
  const removedSummary = buildCountMap(removed);
  if (removedSummary.size === 0) {
    lines.push('  removed: []');
  } else {
    lines.push('  removed:');
    Array.from(removedSummary.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([item, count]) => {
        lines.push(`    - ${formatDiffItem(item, count)}`);
      });
  }
  return lines.join('\n');
};
