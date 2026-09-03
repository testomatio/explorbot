import { parse, serialize } from 'parse5';
import type * as parse5TreeAdapter from 'parse5/lib/tree-adapters/default';
import type { HtmlConfig } from '../config.ts';
import { isTailwindClass, isTrashClass, minifyHtml } from './html.ts';
import { isDynamicId, isGenericClass } from './xpath.ts';

export interface HtmlDiffPart {
  container: string;
  subtree: string;
  rawSize: number;
  added: string[];
  removed: string[];
  appearedSelector?: string;
  containerWasEmpty?: boolean;
}

export interface HtmlDiffResult {
  parts: HtmlDiffPart[];
  added: string[];
  removed: string[];
  similarity: number;
  pageSize: number;
  summary: string;
  messages: string[];
}

interface HtmlNode {
  type: 'element' | 'text' | 'comment';
  tagName?: string;
  attrs?: Array<{ name: string; value: string }>;
  content?: string;
  children?: HtmlNode[];
}

const IGNORED_PATHS = new Set(['html[1]', 'html[1]/head[1]', 'html[1]/body[1]']);

const SHELL_RATIO = 0.8;
const ROOT_CONTENT_RATIO = 0.8;

const LIVE_REGION_ROLES = new Set(['alert', 'alertdialog', 'status', 'log']);
const TEXT_LINE_PREFIX = 'TEXT:';
const MESSAGE_MAX_LENGTH = 200;
const MESSAGE_LIMIT = 8;

type DocumentNode = parse5TreeAdapter.Document;
type ElementNode = parse5TreeAdapter.Element;
type ParentNode = parse5TreeAdapter.Document | parse5TreeAdapter.Element;

type NodeMap = Map<string, ElementNode>;

/**
 * Get text content from an element node.
 */
function getTextContent(element: parse5TreeAdapter.Element): string {
  let text = '';
  function processNode(node: parse5TreeAdapter.Node) {
    if (node.nodeName === '#text') {
      text += (node as parse5TreeAdapter.TextNode).value;
    } else if ('childNodes' in node) {
      node.childNodes.forEach(processNode);
    }
  }
  processNode(element);
  return text;
}

/**
 * Extract document title from a parsed HTML document.
 */
function getDocumentTitle(document: parse5TreeAdapter.Document): string | null {
  if (!document.childNodes) return null;

  const htmlElement = document.childNodes.find((node): node is parse5TreeAdapter.Element => 'tagName' in node && node.tagName?.toLowerCase() === 'html');

  if (!htmlElement || !htmlElement.childNodes) {
    return null;
  }

  const headElement = htmlElement.childNodes.find((node): node is parse5TreeAdapter.Element => 'tagName' in node && node.tagName?.toLowerCase() === 'head');

  if (!headElement || !headElement.childNodes) {
    return null;
  }

  const titleElement = headElement.childNodes.find((node): node is parse5TreeAdapter.Element => 'tagName' in node && node.tagName?.toLowerCase() === 'title');

  if (!titleElement) {
    return null;
  }

  const text = getTextContent(titleElement).trim();
  return text.length > 0 ? text : null;
}

/**
 * Ensure document has a title element in head section.
 */
function ensureDocumentTitle(document: parse5TreeAdapter.Document, titleText: string | null): void {
  if (!titleText || !document.childNodes) {
    return;
  }

  const htmlElement = document.childNodes.find((node): node is parse5TreeAdapter.Element => 'tagName' in node && node.tagName?.toLowerCase() === 'html');

  if (!htmlElement) {
    return;
  }

  const namespace = htmlElement.namespaceURI || 'http://www.w3.org/1999/xhtml';

  let headElement = htmlElement.childNodes.find((node): node is parse5TreeAdapter.Element => 'tagName' in node && node.tagName?.toLowerCase() === 'head');

  if (!headElement) {
    headElement = {
      nodeName: 'head',
      tagName: 'head',
      attrs: [],
      namespaceURI: namespace,
      childNodes: [],
      parentNode: htmlElement,
    } as parse5TreeAdapter.Element;

    // Insert head before body if possible, otherwise prepend
    const bodyIndex = htmlElement.childNodes.findIndex((node) => 'tagName' in node && node.tagName?.toLowerCase() === 'body');

    if (bodyIndex === -1) {
      htmlElement.childNodes.push(headElement);
    } else {
      htmlElement.childNodes.splice(bodyIndex, 0, headElement);
    }
  } else {
    headElement.childNodes = [];
  }

  const titleElement: parse5TreeAdapter.Element = {
    nodeName: 'title',
    tagName: 'title',
    attrs: [],
    namespaceURI: namespace,
    childNodes: [],
    parentNode: headElement,
  };

  const textNode: parse5TreeAdapter.TextNode = {
    nodeName: '#text',
    value: titleText,
  };

  (textNode as any).parentNode = titleElement;
  titleElement.childNodes.push(textNode);
  headElement.childNodes.push(titleElement);
}

/**
 * Type representing nodes that can have child nodes.
 */
type ParentNodeLike = parse5TreeAdapter.Document | parse5TreeAdapter.DocumentFragment | parse5TreeAdapter.Element;

/**
 * Check if a node has child nodes.
 */
function hasChildNodes(node: unknown): node is ParentNodeLike {
  return typeof node === 'object' && node !== null && 'childNodes' in node && Array.isArray((node as any).childNodes);
}

/**
 * Remove elements with specified tags from a node tree.
 */
function stripElementsByTag(node: ParentNodeLike, tagsToRemove: Set<string>): void {
  if (!node.childNodes) return;

  for (let i = node.childNodes.length - 1; i >= 0; i--) {
    const child = node.childNodes[i];

    // Remove comments
    if (child.nodeName === '#comment') {
      node.childNodes.splice(i, 1);
      continue;
    }

    // Remove elements with matching tags
    if ('tagName' in child && child.tagName) {
      const tagName = child.tagName.toLowerCase();
      if (tagsToRemove.has(tagName)) {
        node.childNodes.splice(i, 1);
        continue;
      }
      // Recursively process child elements
      stripElementsByTag(child as ParentNodeLike, tagsToRemove);
    } else if (hasChildNodes(child)) {
      // Recursively process non-element nodes that have children
      stripElementsByTag(child as ParentNodeLike, tagsToRemove);
    }
  }
}

export function computeHtmlFingerprint(html: string): string[] {
  const document = parseDocument(html);
  const root = getRootNodeForFlatten(document);
  return flattenHtml(root);
}

/**
 * Compares two HTML documents and returns differences along with a diff subtree.
 */
export async function htmlDiff(originalHtml: string, modifiedHtml: string, htmlConfig?: HtmlConfig): Promise<HtmlDiffResult> {
  const originalDocument = parseDocument(originalHtml, htmlConfig);
  const modifiedDocument = parseDocument(modifiedHtml, htmlConfig);

  const originalRoot = getRootNodeForFlatten(originalDocument);
  const modifiedRoot = getRootNodeForFlatten(modifiedDocument);

  const originalLines = flattenHtml(originalRoot);
  const modifiedLines = flattenHtml(modifiedRoot);

  const similarity = calculateSimilarity(originalLines, modifiedLines);
  const { added, removed } = findDifferences(originalLines, modifiedLines);

  const originalMap = collectElementMap(originalDocument);
  const modifiedMap = collectElementMap(modifiedDocument);

  const modifiedBody = findBodyElement(modifiedDocument);
  let pageSize = modifiedHtml.length;
  if (modifiedBody) pageSize = serializeNode(modifiedBody).length;

  const parts = await buildDiffParts(originalMap, modifiedMap, pageSize);

  const structuralAdditions = parts.flatMap((p) => p.added.filter((a) => a.startsWith('ELEMENT:')));
  const allAdded = [...added, ...structuralAdditions];
  const totalChanges = allAdded.length + removed.length;
  const summary = totalChanges === 0 && parts.length > 0 ? 'Structural additions detected' : generateSummary(allAdded, removed, similarity);

  return {
    parts,
    added: allAdded,
    removed,
    similarity,
    pageSize,
    summary,
    messages: collectMessages(originalMap, modifiedMap, allAdded),
  };
}

function serializeNode(node: parse5TreeAdapter.Node): string {
  return serialize({ childNodes: [node], nodeName: '#document-fragment' } as any);
}

/**
 * Text the app announced while the page stayed the same: live region content first, then any other text that appeared.
 */
function collectMessages(originalMap: NodeMap, modifiedMap: NodeMap, added: string[]): string[] {
  const appearedText = added.filter((line) => line.startsWith(TEXT_LINE_PREFIX)).map((line) => line.slice(TEXT_LINE_PREFIX.length));

  return limitMessages([...collectLiveRegionTexts(originalMap, modifiedMap), ...appearedText]);
}

/**
 * Text the app announced across a navigation. Only live regions: everything else on a new page is its content, not a message.
 */
export function liveRegionMessages(originalHtml: string, modifiedHtml: string): string[] {
  const originalMap = collectElementMap(parseDocument(originalHtml));
  const modifiedMap = collectElementMap(parseDocument(modifiedHtml));

  return limitMessages(collectLiveRegionTexts(originalMap, modifiedMap));
}

function limitMessages(candidates: string[]): string[] {
  const messages: string[] = [];

  for (const candidate of candidates) {
    const text = candidate.replace(/\s+/g, ' ').trim().slice(0, MESSAGE_MAX_LENGTH);
    if (!text) continue;
    if (messages.some((message) => message.includes(text))) continue;
    messages.push(text);
    if (messages.length === MESSAGE_LIMIT) break;
  }

  return messages;
}

function collectLiveRegionTexts(originalMap: NodeMap, modifiedMap: NodeMap): string[] {
  const texts: string[] = [];

  for (const [path, element] of modifiedMap) {
    if (!isLiveRegion(element)) continue;
    const text = getTextContent(element).trim();
    if (!text) continue;
    const previous = originalMap.get(path);
    if (previous && getTextContent(previous).trim() === text) continue;
    texts.push(text);
  }

  return texts;
}

function isLiveRegion(element: ElementNode): boolean {
  if (element.tagName?.toLowerCase() === 'output') return true;

  const attrs = element.attrs ?? [];
  const role = attrs.find((attr) => attr.name === 'role')?.value.toLowerCase();
  if (role && LIVE_REGION_ROLES.has(role)) return true;

  const live = attrs.find((attr) => attr.name === 'aria-live')?.value.toLowerCase();
  return live === 'polite' || live === 'assertive';
}

/**
 * Parse HTML into a document, wrapping fragments with html/body for consistency.
 * Uses custom sanitization that removes iframes for diff purposes.
 */
function parseDocument(html: string, htmlConfig?: HtmlConfig): DocumentNode {
  const document = parse(html);
  const documentTitle = getDocumentTitle(document);
  sanitizeDocumentTreeForDiff(document);
  ensureDocumentTitle(document, documentTitle);
  return document;
}

/**
 * Custom sanitization for html-diff that removes iframes in addition to standard non-semantic tags.
 */
function sanitizeDocumentTreeForDiff(document: parse5TreeAdapter.Document): void {
  // Remove standard non-semantic tags
  stripElementsByTag(document, new Set([...NON_SEMANTIC_TAGS, 'iframe']));
  pruneDocumentHeadForDiff(document);
}

/**
 * Prune non-essential elements from document head for diff purposes.
 * Only keeps title element, removes everything else.
 */
function pruneDocumentHeadForDiff(document: parse5TreeAdapter.Document): void {
  if (!document.childNodes) return;

  const htmlElement = document.childNodes.find((node): node is parse5TreeAdapter.Element => 'tagName' in node && node.tagName?.toLowerCase() === 'html');

  if (!htmlElement || !htmlElement.childNodes) {
    return;
  }

  const headElement = htmlElement.childNodes.find((node): node is parse5TreeAdapter.Element => 'tagName' in node && node.tagName?.toLowerCase() === 'head');

  if (!headElement || !headElement.childNodes) {
    return;
  }

  for (let i = headElement.childNodes.length - 1; i >= 0; i--) {
    const child = headElement.childNodes[i];
    if ('tagName' in child && child.tagName) {
      const tagName = child.tagName.toLowerCase();
      if (tagName !== 'title') {
        headElement.childNodes.splice(i, 1);
      }
      continue;
    }

    // Remove non-element nodes (like text, comments)
    headElement.childNodes.splice(i, 1);
  }
}

// Copy NON_SEMANTIC_TAGS from html.ts to avoid circular imports
const NON_SEMANTIC_TAGS = new Set([
  'style',
  'script',
  'link',
  'meta',
  'base',
  'template',
  'slot',
  'noscript',
  'frame',
  'frameset',
  'object',
  'embed',
  'path',
  'polygon',
  'polyline',
  'circle',
  'ellipse',
  'line',
  'rect',
  'defs',
  'g',
  'symbol',
  'use',
  'mask',
  'pattern',
  'clippath',
  'animate',
  'animatetransform',
  'animatecolor',
]);

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

function filterContainerClasses(classes: string[]): string[] {
  return classes
    .filter((cls) => !/\d/.test(cls))
    .filter((cls) => !isGenericClass(cls))
    .filter((cls) => !isTrashClass(cls))
    .filter((cls) => !/(:|__)/.test(cls))
    .filter((cls) => !isTailwindClass(cls));
}

function buildContainerSelector(element: ElementNode, allElements: NodeMap): string | null {
  const tag = element.tagName?.toLowerCase();
  if (!tag) return null;

  const attrs = element.attrs ?? [];
  const id = attrs.find((a) => a.name === 'id')?.value;
  if (id && !isDynamicId(id)) return `#${id}`;

  const classAttr = attrs.find((a) => a.name === 'class')?.value;
  if (!classAttr) return null;

  const meaningful = filterContainerClasses(classAttr.split(/\s+/).filter(Boolean));
  if (meaningful.length === 0) return null;

  const selector = `${tag}.${meaningful.join('.')}`;

  let matchCount = 0;
  for (const el of allElements.values()) {
    if (el.tagName?.toLowerCase() !== tag) continue;
    const elClass = (el.attrs ?? []).find((a) => a.name === 'class')?.value || '';
    const elClasses = elClass.split(/\s+/);
    if (meaningful.every((cls) => elClasses.includes(cls))) {
      matchCount++;
      if (matchCount > 1) return null;
    }
  }

  return matchCount === 1 ? selector : null;
}

export function pathToXPath(treePath: string): string {
  const parts = treePath.split('/');
  const bodyIdx = parts.findIndex((p) => p.startsWith('body'));
  if (bodyIdx === -1) return `//${parts.join('/')}`;
  return `//body/${parts.slice(bodyIdx + 1).join('/')}`;
}

function findStableContainer(topLevelPath: string, originalMap: NodeMap, modifiedMap: NodeMap, pageSize: number): { path: string; selector: string } {
  const segments = topLevelPath.split('/');

  for (let i = segments.length - 2; i >= 1; i--) {
    const candidatePath = segments.slice(0, i + 1).join('/');
    if (IGNORED_PATHS.has(candidatePath)) continue;
    if (!originalMap.has(candidatePath) || !modifiedMap.has(candidatePath)) continue;

    const element = modifiedMap.get(candidatePath)!;
    if (pageSize > 0 && serializeNode(element).length >= SHELL_RATIO * pageSize) break;
    const css = buildContainerSelector(element, modifiedMap);
    if (css) return { path: candidatePath, selector: css };
    return { path: candidatePath, selector: pathToXPath(candidatePath) };
  }

  return { path: 'html[1]/body[1]', selector: 'body' };
}

function dominantChild(element: ElementNode): ElementNode | null {
  const children = (element.childNodes ?? []).filter((child): child is ElementNode => 'tagName' in child && !!child.tagName);
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  const parentSize = serializeNode(element).length;
  if (!parentSize) return null;
  for (const child of children) {
    if (serializeNode(child).length >= ROOT_CONTENT_RATIO * parentSize) return child;
  }
  return null;
}

function semanticSelectorFor(element: ElementNode, allElements: NodeMap): string | undefined {
  let current: ElementNode | null = element;
  while (current) {
    const selector = buildContainerSelector(current, allElements);
    if (selector) return selector;
    current = dominantChild(current);
  }
  return undefined;
}

async function buildDiffParts(originalMap: NodeMap, modifiedMap: NodeMap, pageSize: number): Promise<HtmlDiffPart[]> {
  const addedPaths: string[] = [];
  const changedPaths: string[] = [];

  for (const [path, element] of modifiedMap.entries()) {
    if (IGNORED_PATHS.has(path)) continue;

    const originalElement = originalMap.get(path);

    if (!originalElement) {
      addedPaths.push(path);
      continue;
    }

    if (attributesDiffer(element, originalElement)) {
      changedPaths.push(path);
    }
  }

  if (addedPaths.length === 0 && changedPaths.length === 0) return [];

  const addedTopLevel = filterTopLevelPaths(addedPaths);
  const changedFiltered = changedPaths.filter((path) => !addedTopLevel.some((ancestor) => isSameOrAncestor(ancestor, path)));
  const changedTopLevel = filterTopLevelPaths(changedFiltered);

  const allTopLevel = [...addedTopLevel, ...changedTopLevel];

  const grouped = new Map<string, { selector: string; paths: string[] }>();

  for (const path of allTopLevel) {
    const { path: containerPath, selector } = findStableContainer(path, originalMap, modifiedMap, pageSize);
    const existing = grouped.get(containerPath);
    if (existing) {
      existing.paths.push(path);
    } else {
      grouped.set(containerPath, { selector, paths: [path] });
    }
  }

  const parts: HtmlDiffPart[] = [];

  for (const [containerPath, { selector, paths }] of grouped) {
    const containerElement = modifiedMap.get(containerPath);
    if (!containerElement) continue;

    const rootClone = cloneElementShallow(containerElement);
    const diffMap: NodeMap = new Map();
    diffMap.set(containerPath, rootClone);

    for (const path of paths) {
      const pathSegments = path.split('/');
      const containerDepth = containerPath.split('/').length;
      for (let i = containerDepth + 1; i < pathSegments.length; i++) {
        const prefix = pathSegments.slice(0, i).join('/');
        if (diffMap.has(prefix)) continue;
        const sourceNode = modifiedMap.get(prefix);
        const parentPath = pathSegments.slice(0, i - 1).join('/');
        const parentNode = diffMap.get(parentPath);
        if (!sourceNode || !parentNode) continue;
        const clone = cloneElementShallow(sourceNode);
        appendChild(parentNode, clone);
        diffMap.set(prefix, clone);
      }

      const sourceElement = modifiedMap.get(path);
      const parentPath = getParentPath(path);
      const parentNode = diffMap.get(parentPath);
      if (!sourceElement || !parentNode) continue;

      appendChild(parentNode, cloneElementDeep(sourceElement));
    }

    const serialized = serialize({ childNodes: [rootClone], nodeName: '#document-fragment' } as any).trim();
    const subtree = serialized ? await minifyHtml(serialized) : '';
    if (!subtree) continue;

    const appearedPaths = paths.filter((p) => addedTopLevel.includes(p));
    const sizeOf = (p: string) => {
      const node = modifiedMap.get(p);
      if (!node) return 0;
      return serializeNode(node).length;
    };
    appearedPaths.sort((a, b) => sizeOf(b) - sizeOf(a));
    const addedLines = appearedPaths.map((p) => `ELEMENT:${p}`);
    const removedLines: string[] = [];

    const heldContentBefore = (originalMap.get(containerPath)?.childNodes ?? []).some((child) => 'tagName' in child && !!child.tagName);
    const part: HtmlDiffPart = { container: selector, subtree, rawSize: serialized.length, added: addedLines, removed: removedLines, containerWasEmpty: !heldContentBefore };
    const appearedPath = appearedPaths[0];
    if (appearedPath) {
      const appearedElement = modifiedMap.get(appearedPath);
      if (appearedElement) {
        const appearedSelector = semanticSelectorFor(appearedElement, modifiedMap);
        if (appearedSelector) part.appearedSelector = appearedSelector;
      }
    }
    parts.push(part);
  }

  return parts;
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
      htmlNode.children = undefined;
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
        lines.push(`${TEXT_LINE_PREFIX}${n.content}`);
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
        lines.push(`${TEXT_LINE_PREFIX}${n.content}`);
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
