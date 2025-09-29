import { parse, serialize } from 'parse5';
import type * as parse5TreeAdapter from 'parse5/lib/tree-adapters/default';
import type { HtmlConfig } from '../config.ts';
import { sanitizeHtmlDocument } from './html.ts';

export interface HtmlDiffResult {
  added: string[];
  removed: string[];
  similarity: number;
  summary: string;
  subtree: string;
}

interface HtmlNode {
  type: 'element' | 'text' | 'comment';
  tagName?: string;
  attrs?: Array<{ name: string; value: string }>;
  content?: string;
  children?: HtmlNode[];
}

const IGNORED_PATHS = new Set(['html[1]', 'html[1]/head[1]', 'html[1]/body[1]']);

type DocumentNode = parse5TreeAdapter.Document;
type ElementNode = parse5TreeAdapter.Element;
type ParentNode = parse5TreeAdapter.Document | parse5TreeAdapter.Element;

type NodeMap = Map<string, ElementNode>;

/**
 * Compares two HTML documents and returns differences along with a diff subtree.
 */
export function htmlDiff(originalHtml: string, modifiedHtml: string, htmlConfig?: HtmlConfig): HtmlDiffResult {
  const originalDocument = parseDocument(originalHtml, htmlConfig);
  const modifiedDocument = parseDocument(modifiedHtml, htmlConfig);

  const originalRoot = getRootNodeForFlatten(originalDocument);
  const modifiedRoot = getRootNodeForFlatten(modifiedDocument);

  const originalLines = flattenHtml(originalRoot);
  const modifiedLines = flattenHtml(modifiedRoot);

  const similarity = calculateSimilarity(originalLines, modifiedLines);
  const { added, removed } = findDifferences(originalLines, modifiedLines);

  const { subtree, structuralTopLevelPaths } = buildDiffSubtree(originalDocument, modifiedDocument);

  const structuralAdditions = structuralTopLevelPaths.map((path) => `ELEMENT:${path}`);
  const allAdded = [...added, ...structuralAdditions];
  const totalChanges = allAdded.length + removed.length;
  const summary = totalChanges === 0 && subtree ? 'Structural additions detected' : generateSummary(allAdded, removed, similarity);

  return {
    added: allAdded,
    removed,
    similarity,
    summary,
    subtree,
  };
}

/**
 * Parse HTML into a document, wrapping fragments with html/body for consistency.
 */
function parseDocument(html: string, htmlConfig?: HtmlConfig): DocumentNode {
  return sanitizeHtmlDocument(html, htmlConfig);
}

/**
 * Returns the body (preferred) or html element converted into HtmlNode for flattening.
 */
function getRootNodeForFlatten(document: DocumentNode): HtmlNode {
  const body = findBodyElement(document);
  if (body) {
    return convertNode(body);
  }

  const htmlElement = findHtmlElement(document);
  if (htmlElement) {
    return convertNode(htmlElement);
  }

  return {
    type: 'element',
    tagName: 'document',
    children: [],
  };
}

const attributesDiffer = (current: ElementNode, previous: ElementNode): boolean => {
  const currentAttrs = current.attrs ?? [];
  const previousAttrs = previous.attrs ?? [];

  if (currentAttrs.length !== previousAttrs.length) {
    return true;
  }

  const previousMap = new Map(previousAttrs.map((attr) => [attr.name, attr.value]));

  for (const attr of currentAttrs) {
    if (previousMap.get(attr.name) !== attr.value) {
      return true;
    }
  }

  return false;
};

const getDirectTextValues = (element: ElementNode): string[] => {
  if (!element.childNodes || element.childNodes.length === 0) {
    return [];
  }

  const values: string[] = [];

  for (const child of element.childNodes) {
    if (child.nodeName === '#text') {
      const value = (child as parse5TreeAdapter.TextNode).value.trim();
      if (value.length > 0) {
        values.push(value);
      }
    }
  }

  return values;
};

const directTextDiffer = (current: ElementNode, previous: ElementNode): boolean => {
  const currentText = getDirectTextValues(current);
  const previousText = getDirectTextValues(previous);

  if (currentText.length !== previousText.length) {
    return true;
  }

  for (let i = 0; i < currentText.length; i++) {
    if (currentText[i] !== previousText[i]) {
      return true;
    }
  }

  return false;
};

/**
 * Build a diff subtree representing new or changed elements in the modified document.
 */
function buildDiffSubtree(originalDocument: DocumentNode, modifiedDocument: DocumentNode): { subtree: string; structuralTopLevelPaths: string[] } {
  const originalMap = collectElementMap(originalDocument);
  const modifiedMap = collectElementMap(modifiedDocument);

  const addedPaths: string[] = [];
  const changedPaths: string[] = [];

  for (const [path, element] of modifiedMap.entries()) {
    if (IGNORED_PATHS.has(path)) {
      continue;
    }

    const originalElement = originalMap.get(path);

    if (!originalElement) {
      addedPaths.push(path);
      continue;
    }

    const attrDiff = attributesDiffer(element, originalElement);
    const textDiff = directTextDiffer(element, originalElement);

    if (attrDiff) {
      changedPaths.push(path);
    }

    if (textDiff) {
      // Text differences are represented in flattened lines; no subtree clone required.
    }
  }

  if (addedPaths.length === 0 && changedPaths.length === 0) {
    return { subtree: '', structuralTopLevelPaths: [] };
  }

  const addedTopLevel = filterTopLevelPaths(addedPaths);
  const changedFiltered = changedPaths.filter((path) => !addedTopLevel.some((ancestor) => isSameOrAncestor(ancestor, path)));
  const changedTopLevel = filterTopLevelPaths(changedFiltered);

  const combinedPaths = [...addedTopLevel, ...changedTopLevel].sort((a, b) => a.length - b.length);

  const diffDocument = parse('<!DOCTYPE html><html><head></head><body></body></html>');
  const diffHtml = findHtmlElement(diffDocument);
  const diffHead = findHeadElement(diffDocument);
  const diffBody = findBodyElement(diffDocument);

  if (!diffHtml || !diffBody) {
    return { subtree: '', structuralTopLevelPaths: [] };
  }

  const diffMap: NodeMap = new Map();
  diffMap.set('html[1]', diffHtml);
  if (diffHead) {
    diffMap.set('html[1]/head[1]', diffHead);
  }
  diffMap.set('html[1]/body[1]', diffBody);

  for (const path of combinedPaths) {
    ensureAncestors(path, diffMap, modifiedMap);

    const sourceElement = modifiedMap.get(path);
    const parentPath = getParentPath(path);
    const parentNode = parentPath ? diffMap.get(parentPath) : diffHtml;

    if (!sourceElement || !parentNode) {
      continue;
    }

    const clone = cloneElementDeep(sourceElement);
    appendChild(parentNode, clone);
    diffMap.set(path, clone);
  }

  return {
    subtree: serialize(diffDocument).trim(),
    structuralTopLevelPaths: [...addedTopLevel, ...changedTopLevel],
  };
}

/**
 * Collect a map of element paths to nodes using nth-of-type indexing.
 */
function collectElementMap(document: DocumentNode): NodeMap {
  const map: NodeMap = new Map();
  const htmlElement = findHtmlElement(document);
  if (!htmlElement) {
    return map;
  }

  traverse(htmlElement, 'html[1]');
  return map;

  function traverse(element: ElementNode, currentPath: string): void {
    map.set(currentPath, element);

    if (!element.childNodes || element.childNodes.length === 0) {
      return;
    }

    const counts = new Map<string, number>();

    for (const child of element.childNodes) {
      if ('tagName' in child && child.tagName) {
        const tagName = child.tagName.toLowerCase();
        const index = (counts.get(tagName) ?? 0) + 1;
        counts.set(tagName, index);
        const childPath = `${currentPath}/${tagName}[${index}]`;
        traverse(child as ElementNode, childPath);
      }
    }
  }
}

function filterTopLevelPaths(paths: string[]): string[] {
  const uniquePaths = Array.from(new Set(paths));
  uniquePaths.sort((a, b) => a.length - b.length);

  const result: string[] = [];

  for (const path of uniquePaths) {
    if (result.some((existing) => isSameOrAncestor(existing, path))) {
      continue;
    }
    result.push(path);
  }

  return result;
}

function ensureAncestors(path: string, targetMap: NodeMap, sourceMap: NodeMap): void {
  const segments = path.split('/');

  for (let i = 1; i < segments.length - 1; i++) {
    const prefix = segments.slice(0, i + 1).join('/');
    if (targetMap.has(prefix)) {
      continue;
    }

    const sourceNode = sourceMap.get(prefix);
    const parentPath = segments.slice(0, i).join('/');
    const parentNode = targetMap.get(parentPath);

    if (!sourceNode || !parentNode) {
      continue;
    }

    const clone = cloneElementShallow(sourceNode);
    appendChild(parentNode, clone);
    targetMap.set(prefix, clone);
  }
}

function getParentPath(path: string): string {
  const lastSeparator = path.lastIndexOf('/');
  if (lastSeparator === -1) {
    return '';
  }
  return path.slice(0, lastSeparator);
}

function isSameOrAncestor(ancestor: string, path: string): boolean {
  return ancestor === path || path.startsWith(`${ancestor}/`);
}

function appendChild(parent: ParentNode, child: parse5TreeAdapter.Node): void {
  if (!parent.childNodes) {
    parent.childNodes = [];
  }

  parent.childNodes.push(child);
  (child as parse5TreeAdapter.Node & { parentNode?: ParentNode }).parentNode = parent;
}

function cloneElementShallow(element: ElementNode): ElementNode {
  return {
    nodeName: element.nodeName,
    tagName: element.tagName,
    attrs: element.attrs ? element.attrs.map((attr) => ({ ...attr })) : [],
    childNodes: [],
    namespaceURI: element.namespaceURI,
  };
}

function cloneElementDeep(element: ElementNode): ElementNode {
  const clone = cloneElementShallow(element);

  if (!element.childNodes || element.childNodes.length === 0) {
    return clone;
  }

  for (const child of element.childNodes) {
    const clonedChild = cloneNodeDeep(child);
    appendChild(clone, clonedChild);
  }

  return clone;
}

function cloneNodeDeep(node: parse5TreeAdapter.Node): parse5TreeAdapter.Node {
  if ('tagName' in node && node.tagName) {
    return cloneElementDeep(node as ElementNode);
  }

  if (node.nodeName === '#text') {
    const textNode = node as parse5TreeAdapter.TextNode;
    return {
      nodeName: '#text',
      value: textNode.value,
    } as parse5TreeAdapter.TextNode;
  }

  if (node.nodeName === '#comment') {
    const commentNode = node as parse5TreeAdapter.CommentNode;
    return {
      nodeName: '#comment',
      data: commentNode.data,
    } as parse5TreeAdapter.CommentNode;
  }

  return { ...node };
}

function findHtmlElement(document: DocumentNode): ElementNode | null {
  if (!document.childNodes) {
    return null;
  }

  for (const node of document.childNodes) {
    if ('tagName' in node && node.tagName && node.tagName.toLowerCase() === 'html') {
      return node as ElementNode;
    }
  }

  return null;
}

function findHeadElement(document: DocumentNode): ElementNode | null {
  const html = findHtmlElement(document);
  if (!html || !html.childNodes) {
    return null;
  }

  for (const node of html.childNodes) {
    if ('tagName' in node && node.tagName && node.tagName.toLowerCase() === 'head') {
      return node as ElementNode;
    }
  }

  return null;
}

function findBodyElement(document: DocumentNode): ElementNode | null {
  const html = findHtmlElement(document);
  if (!html || !html.childNodes) {
    return null;
  }

  for (const node of html.childNodes) {
    if ('tagName' in node && node.tagName && node.tagName.toLowerCase() === 'body') {
      return node as ElementNode;
    }
  }

  return null;
}

/**
 * Convert parse5 node to simplified representation for textual diffing.
 */
function convertNode(node: parse5TreeAdapter.Node): HtmlNode {
  if (node.nodeName === '#text') {
    const textNode = node as parse5TreeAdapter.TextNode;
    return {
      type: 'text',
      content: textNode.value.trim(),
    };
  }

  if (node.nodeName === '#comment') {
    return {
      type: 'comment',
      content: (node as parse5TreeAdapter.CommentNode).data,
    };
  }

  if ('tagName' in node && node.tagName) {
    const element = node as ElementNode;
    const htmlNode: HtmlNode = {
      type: 'element',
      tagName: element.tagName.toLowerCase(),
    };

    if (element.attrs && element.attrs.length > 0) {
      htmlNode.attrs = element.attrs.map((attr) => ({
        name: attr.name,
        value: attr.value,
      }));
    }

    if (element.childNodes && element.childNodes.length > 0) {
      const children: HtmlNode[] = [];

      for (const child of element.childNodes) {
        if (child.nodeName === '#text') {
          const text = (child as parse5TreeAdapter.TextNode).value.trim();
          if (text.length === 0) {
            continue;
          }
        }
        children.push(convertNode(child));
      }

      if (children.length > 0) {
        htmlNode.children = children;
      }
    }

    if (htmlNode.children && htmlNode.children.length === 1 && htmlNode.children[0].type === 'text') {
      htmlNode.content = htmlNode.children[0].content;
      delete htmlNode.children;
    }

    return htmlNode;
  }

  return {
    type: 'text',
    content: '',
  };
}

/**
 * Flatten HTML structure into lines for comparison.
 */
function flattenHtml(node: HtmlNode): string[] {
  const lines: string[] = [];

  function process(n: HtmlNode): void {
    if (n.type === 'text' && n.content) {
      if (n.content.length >= 5) {
        lines.push(`TEXT:${n.content}`);
      }
      return;
    }

    if (n.type === 'comment') {
      return;
    }

    if (n.type === 'element' && n.tagName) {
      if (isInteractiveElement(n)) {
        const content = getElementContent(n);
        if (content) {
          lines.push(`${n.tagName.toUpperCase()}:${content}`);
        } else {
          lines.push(`${n.tagName.toUpperCase()}`);
        }
        return;
      }

      if (n.content && n.content.length >= 5) {
        lines.push(`TEXT:${n.content}`);
      }

      if (n.children) {
        n.children.forEach((child) => process(child));
      }
    }
  }

  process(node);
  return lines;
}

function isInteractiveElement(node: HtmlNode): boolean {
  if (!node.tagName) {
    return false;
  }

  const interactiveTags = new Set(['a', 'button', 'input', 'select', 'textarea', 'details', 'summary']);

  if (interactiveTags.has(node.tagName)) {
    return true;
  }

  if (node.attrs) {
    const role = node.attrs.find((attr) => attr.name === 'role');
    if (role && ['button', 'link', 'checkbox', 'radio', 'combobox', 'listbox', 'textbox', 'switch', 'tab'].includes(role.value)) {
      return true;
    }
  }

  return false;
}

function getElementContent(node: HtmlNode): string {
  if (node.content) {
    return node.content;
  }

  if (node.attrs) {
    if (node.tagName === 'input') {
      const placeholder = node.attrs.find((attr) => attr.name === 'placeholder');
      if (placeholder) {
        return placeholder.value;
      }

      const value = node.attrs.find((attr) => attr.name === 'value');
      if (value) {
        return value.value;
      }

      const name = node.attrs.find((attr) => attr.name === 'name');
      if (name) {
        return name.value;
      }
    }

    if (node.tagName === 'a') {
      const href = node.attrs.find((attr) => attr.name === 'href');
      if (href) {
        return href.value;
      }
    }
  }

  return '';
}

function calculateSimilarity(lines1: string[], lines2: string[]): number {
  const set1 = new Set(lines1);
  const set2 = new Set(lines2);

  const intersection = new Set([...set1].filter((x) => set2.has(x)));
  const union = new Set([...set1, ...set2]);

  if (union.size === 0) {
    return 100;
  }

  return Math.round((intersection.size / union.size) * 100);
}

function findDifferences(
  lines1: string[],
  lines2: string[]
): {
  added: string[];
  removed: string[];
} {
  const set1 = new Set(lines1);
  const set2 = new Set(lines2);

  const added = [...set2].filter((line) => !set1.has(line));
  const removed = [...set1].filter((line) => !set2.has(line));

  return { added, removed };
}

function generateSummary(added: string[], removed: string[], similarity: number): string {
  const totalChanges = added.length + removed.length;

  if (totalChanges === 0) {
    return 'No changes detected';
  }

  const parts: string[] = [];

  if (similarity < 100) {
    parts.push(`${similarity}% similar`);
  }

  if (added.length > 0) {
    parts.push(`${added.length} addition${added.length > 1 ? 's' : ''}`);
  }

  if (removed.length > 0) {
    parts.push(`${removed.length} removal${removed.length > 1 ? 's' : ''}`);
  }

  return parts.join(', ');
}
