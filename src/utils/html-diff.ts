import { parse, parseFragment, serialize } from 'parse5';
import type * as parse5TreeAdapter from 'parse5/lib/tree-adapters/default';

export interface HtmlDiffResult {
  added: string[];
  removed: string[];
  similarity: number;
  summary: string;
}

interface HtmlNode {
  type: 'element' | 'text' | 'comment';
  tagName?: string;
  attrs?: Array<{ name: string; value: string }>;
  content?: string;
  children?: HtmlNode[];
}

/**
 * Compares two HTML documents and returns differences
 */
export function htmlDiff(html1: string, html2: string): HtmlDiffResult {
  // Parse both HTML documents
  const doc1 = parseHtml(html1);
  const doc2 = parseHtml(html2);

  // Convert to simplified representation
  const nodes1 = flattenHtml(doc1);
  const nodes2 = flattenHtml(doc2);

  // Calculate similarity using a simple approach
  const similarity = calculateSimilarity(nodes1, nodes2);

  // Find differences
  const { added, removed } = findDifferences(nodes1, nodes2);

  // Generate summary
  const summary = generateSummary(added, removed, similarity);

  return {
    added,
    removed,
    similarity,
    summary,
  };
}

/**
 * Parse HTML (handles both fragments and full documents)
 */
function parseHtml(html: string): HtmlNode {
  const trimmedHtml = html.trim();

  // Always parse as document for consistency
  const document = parse(html);
  const body = findBody(document);
  if (!body) {
    return convertNode(document);
  }

  return convertNode(body);
}

/**
 * Convert parse5 node to our simplified format
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

  if ('tagName' in node) {
    const element = node as parse5TreeAdapter.Element;
    const htmlNode: HtmlNode = {
      type: 'element',
      tagName: element.tagName.toLowerCase(),
    };

    // Add attributes
    if (element.attrs && element.attrs.length > 0) {
      htmlNode.attrs = element.attrs.map((attr) => ({
        name: attr.name,
        value: attr.value,
      }));
    }

    // Add children
    if (element.childNodes && element.childNodes.length > 0) {
      htmlNode.children = element.childNodes
        .filter((child) => {
          // Skip whitespace-only text nodes
          if (child.nodeName === '#text') {
            const text = (child as parse5TreeAdapter.TextNode).value.trim();
            return text.length > 0;
          }
          return true;
        })
        .map((child) => convertNode(child));
    }

    // If it's a text-only element, store content directly
    if (
      htmlNode.children &&
      htmlNode.children.length === 1 &&
      htmlNode.children[0].type === 'text'
    ) {
      htmlNode.content = htmlNode.children[0].content;
      delete htmlNode.children;
    }

    // For interactive elements that are self-closing (like input), keep them
    if (htmlNode.tagName === 'input' && !htmlNode.children) {
      // Input is self-closing, no children
    }

    return htmlNode;
  }

  return {
    type: 'text',
    content: '',
  };
}

/**
 * Find body element in document
 */
function findBody(
  document: parse5TreeAdapter.Document
): parse5TreeAdapter.Element | null {
  const html = document.childNodes.find((node) => node.nodeName === 'html');
  if (!html || !('childNodes' in html)) return null;

  return (
    (html.childNodes.find(
      (node) => node.nodeName === 'body'
    ) as parse5TreeAdapter.Element) || null
  );
}

/**
 * Flatten HTML structure into lines for comparison
 */
function flattenHtml(node: HtmlNode): string[] {
  const lines: string[] = [];

  function process(n: HtmlNode, path = ''): void {
    if (n.type === 'text' && n.content) {
      // Only include text longer than 5 characters
      if (n.content.length >= 5) {
        lines.push(`TEXT:${n.content}`);
      }
      return;
    }

    if (n.type === 'comment') {
      return; // Skip comments
    }

    if (n.type === 'element' && n.tagName) {
      // For interactive elements, include them specially
      if (isInteractiveElement(n)) {
        const content = getElementContent(n);
        if (content) {
          lines.push(`${n.tagName.toUpperCase()}:${content}`);
        } else {
          lines.push(`${n.tagName.toUpperCase()}`);
        }
        return; // Don't process children of interactive elements
      }

      // Also include text content if element has it
      if (n.content && n.content.length >= 5) {
        lines.push(`TEXT:${n.content}`);
      }

      // Process children
      if (n.children) {
        n.children.forEach((child) =>
          process(child, path ? `${path} > ${n.tagName}` : n.tagName)
        );
      }
    }
  }

  process(node);
  return lines;
}

/**
 * Check if element is interactive
 */
function isInteractiveElement(node: HtmlNode): boolean {
  if (!node.tagName) return false;

  const interactiveTags = [
    'a',
    'button',
    'input',
    'select',
    'textarea',
    'details',
    'summary',
  ];

  if (interactiveTags.includes(node.tagName)) {
    return true;
  }

  // Check for interactive roles
  if (node.attrs) {
    const role = node.attrs.find((attr) => attr.name === 'role');
    if (
      role &&
      [
        'button',
        'link',
        'checkbox',
        'radio',
        'combobox',
        'listbox',
        'textbox',
        'switch',
        'tab',
      ].includes(role.value)
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Check if element is an important text element
 */
function isImportantTextElement(tagName: string): boolean {
  return [
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'p',
    'li',
    'label',
    'title',
  ].includes(tagName);
}

/**
 * Get content from an element
 */
function getElementContent(node: HtmlNode): string {
  if (node.content) {
    return node.content;
  }

  if (node.attrs) {
    // For inputs, use placeholder or value
    if (node.tagName === 'input') {
      const placeholder = node.attrs.find(
        (attr) => attr.name === 'placeholder'
      );
      if (placeholder) return placeholder.value;

      const value = node.attrs.find((attr) => attr.name === 'value');
      if (value) return value.value;

      const name = node.attrs.find((attr) => attr.name === 'name');
      if (name) return name.value;
    }

    // For links, use href if no text content
    if (node.tagName === 'a') {
      const href = node.attrs.find((attr) => attr.name === 'href');
      if (href) return href.value;
    }
  }

  return '';
}

/**
 * Calculate similarity percentage between two sets of lines
 */
function calculateSimilarity(lines1: string[], lines2: string[]): number {
  const set1 = new Set(lines1);
  const set2 = new Set(lines2);

  const intersection = new Set([...set1].filter((x) => set2.has(x)));
  const union = new Set([...set1, ...set2]);

  if (union.size === 0) return 100; // Both empty

  return Math.round((intersection.size / union.size) * 100);
}

/**
 * Find added and removed lines
 */
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

/**
 * Generate human-readable summary
 */
function generateSummary(
  added: string[],
  removed: string[],
  similarity: number
): string {
  const totalChanges = added.length + removed.length;

  if (totalChanges === 0) {
    return 'No changes detected';
  }

  const parts = [];

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
