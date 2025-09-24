import { parse, parseFragment, serialize } from 'parse5';
import type * as parse5TreeAdapter from 'parse5/lib/tree-adapters/default';
import type { HtmlConfig } from './config.js';

/**
 * Extracts added HTML elements from diff paths and constructs a valid HTML tree
 */
export interface ExtractedHtmlResult {
  html: string;
  extractedCount: number;
}

interface ElementPath {
  path: string;
  tagName: string;
  attrs?: Array<{ name: string; value: string }>;
}

/**
 * Extracts added elements from HTML based on their paths
 */
export function extractAddedElements(
  originalHtml: string,
  modifiedHtml: string,
  addedPaths: string[]
): ExtractedHtmlResult {
  // Parse both HTML documents
  const originalDoc = parseHtml(originalHtml);
  const modifiedDoc = parseHtml(modifiedHtml);

  // Debug: log the modified structure
  // console.log('Modified doc structure:', serialize(modifiedDoc));

  // Extract elements from the modified document based on paths
  const extractedElements: parse5TreeAdapter.Element[] = [];

  // Convert paths to a more usable format
  const pathInfo = addedPaths.map((path) => {
    // Parse path like "html > body > div > p" to get the final tag
    const parts = path.split(' > ');
    const tagName = parts[parts.length - 1];
    return { path, tagName };
  });

  // Find and extract elements
  // console.log('Searching for paths:', addedPaths);
  pathInfo.forEach((info) => {
    // console.log(`Looking for path: ${info.path}, tag: ${info.tagName}`);

    // Try exact path matching first - start from document root
    let elements = findElementsByPath(modifiedDoc, info.path);
    // console.log(`Exact match found: ${elements.length}`);

    // If no elements found, try flexible matching
    if (elements.length === 0) {
      elements = findElementsByPathFlexible(modifiedDoc, info.path);
      // console.log(`Flexible match found: ${elements.length}`);
    }

    // console.log(`Total elements found for ${info.path}: ${elements.length}`);
    extractedElements.push(...elements);
  });

  // Build a new HTML tree with the extracted elements
  const resultHtml = buildHtmlTree(extractedElements);

  // Debug: log what we found
  // if (extractedElements.length > 0) {
  //   console.log('Found elements:', extractedElements.map(el => el.tagName));
  //   console.log('Built HTML:', resultHtml);
  // }

  return {
    html: resultHtml,
    extractedCount: extractedElements.length,
  };
}

/**
 * Parse HTML (handles both fragments and full documents)
 */
function parseHtml(html: string): parse5TreeAdapter.Document {
  const trimmedHtml = html.trim();

  if (trimmedHtml.startsWith('<html') || trimmedHtml.includes('<html')) {
    return parse(html);
  } else {
    // For fragments, parse directly as document with body content
    return parse(
      `<!DOCTYPE html><html><head></head><body>${html}</body></html>`
    );
  }
}

/**
 * Find elements by their path in the document
 */
function findElementsByPath(
  node: parse5TreeAdapter.Node,
  path: string,
  currentPath = ''
): parse5TreeAdapter.Element[] {
  const results: parse5TreeAdapter.Element[] = [];

  // console.log(`findElementsByPath called with node: ${node.nodeName}, currentPath: "${currentPath}"`);

  // If it's a document node, process its children
  if (node.nodeName === '#document' && 'childNodes' in node) {
    // console.log(`Processing document node with ${node.childNodes.length} children`);
    node.childNodes.forEach((child) => {
      results.push(...findElementsByPath(child, path, currentPath));
    });
    return results;
  }

  if ('tagName' in node) {
    const element = node as parse5TreeAdapter.Element;
    const elementPath = currentPath
      ? `${currentPath} > ${element.tagName.toLowerCase()}`
      : element.tagName.toLowerCase();

    // Debug: log paths
    // if (element.tagName.toLowerCase() === 'button') {
    //   console.log(`Found button at path: ${elementPath}`);
    // }

    if (elementPath === path) {
      // console.log(`Exact match found at: ${elementPath}`);
      results.push(element);
    }

    // Process children
    if (element.childNodes) {
      element.childNodes.forEach((child) => {
        results.push(...findElementsByPath(child, path, elementPath));
      });
    }
  }

  return results;
}

/**
 * Find elements by their path with more flexible matching
 */
function findElementsByPathFlexible(
  node: parse5TreeAdapter.Node,
  path: string
): parse5TreeAdapter.Element[] {
  const results: parse5TreeAdapter.Element[] = [];

  // Handle different path formats
  const pathParts = path.split(' > ').filter((p) => p);
  const lastPart = pathParts[pathParts.length - 1];

  function search(node: parse5TreeAdapter.Node) {
    if ('tagName' in node) {
      const element = node as parse5TreeAdapter.Element;

      // Check if this element matches the target tag
      if (element.tagName.toLowerCase() === lastPart.toLowerCase()) {
        results.push(element);
      }

      // Continue searching children
      if (element.childNodes) {
        element.childNodes.forEach((child) => search(child));
      }
    }
  }

  search(node);
  return results;
}

/**
 * Build a valid HTML tree from extracted elements
 */
function buildHtmlTree(elements: parse5TreeAdapter.Element[]): string {
  if (elements.length === 0) {
    return '';
  }

  // Create a container element
  const container = parseFragment('<div></div>') as parse5TreeAdapter.Element;

  // Add all extracted elements to the container
  elements.forEach((element) => {
    // Clone the element to avoid modifying the original
    const clonedElement = cloneElement(element);
    container.childNodes.push(clonedElement);
  });

  // Serialize the container content
  const result = serialize(container);

  // Extract just the inner content (remove the wrapper div)
  const match = result.match(/^<div>([\s\S]*)<\/div>$/);
  if (match) {
    return match[1].trim();
  }

  return result;
}

/**
 * Clone an element and its children
 */
function cloneElement(
  element: parse5TreeAdapter.Element
): parse5TreeAdapter.Element {
  const clone: parse5TreeAdapter.Element = {
    nodeName: element.nodeName,
    tagName: element.tagName,
    attrs: element.attrs ? [...element.attrs] : [],
    childNodes: [],
  };

  // Clone children
  if (element.childNodes) {
    element.childNodes.forEach((child) => {
      if (child.nodeName === '#text') {
        const textChild = child as parse5TreeAdapter.TextNode;
        clone.childNodes.push({
          nodeName: '#text',
          value: textChild.value,
        });
      } else if ('tagName' in child) {
        clone.childNodes.push(cloneElement(child as parse5TreeAdapter.Element));
      }
    });
  }

  return clone;
}

/**
 * Find the body element in a document
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
 * Enhanced version that also handles CSS selectors
 */
export function extractAddedElementsWithSelectors(
  originalHtml: string,
  modifiedHtml: string,
  addedPaths: string[],
  config?: HtmlConfig
): ExtractedHtmlResult {
  // Filter paths based on exclude selectors
  let filteredPaths = addedPaths;

  if (config && config.exclude) {
    // Parse the modified HTML to check elements
    const modifiedDoc = parseHtml(modifiedHtml);

    // Only include paths whose target elements are not excluded
    filteredPaths = addedPaths.filter((path) => {
      const elements = findElementsByPath(modifiedDoc, path);
      return elements.some((element) => shouldKeepElement(element, config));
    });
  }

  // Extract elements using filtered paths
  const result = extractAddedElements(
    originalHtml,
    modifiedHtml,
    filteredPaths
  );

  if (!config || (!config.include && !config.exclude)) {
    return result;
  }

  // Parse the result HTML to apply CSS selector filtering
  const fragment = parseFragment(result.html) as parse5TreeAdapter.Element;

  // Filter the tree based on selectors
  filterTreeWithConfig(fragment, config);

  return {
    html: serialize(fragment),
    extractedCount: result.extractedCount,
  };
}

/**
 * Filter tree based on CSS selector configuration
 */
function filterTreeWithConfig(
  element: parse5TreeAdapter.Element,
  config: HtmlConfig,
  parentMatchesInclude = false
): boolean {
  if (!element.childNodes) return false;

  let hasKeepableContent = false;
  const children = [...element.childNodes];
  const currentMatchesInclude = config.include
    ? matchesAnySelector(element, config.include)
    : false;

  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i];

    if ('tagName' in child) {
      const childElement = child as parse5TreeAdapter.Element;
      const childHasContent = filterTreeWithConfig(
        childElement,
        config,
        currentMatchesInclude || parentMatchesInclude
      );

      // Check if this element should be removed based on selectors
      if (
        !shouldKeepElement(
          childElement,
          config,
          currentMatchesInclude || parentMatchesInclude
        )
      ) {
        // Always remove if it matches exclude selectors, regardless of parent
        const index = element.childNodes.indexOf(child);
        if (index > -1) {
          element.childNodes.splice(index, 1);
        }
        continue;
      }

      hasKeepableContent = true;
    } else if (child.nodeName === '#text') {
      const text = (child as parse5TreeAdapter.TextNode).value.trim();
      if (text.length > 0) {
        hasKeepableContent = true;
      }
    }
  }

  return (
    hasKeepableContent ||
    shouldKeepElement(element, config, parentMatchesInclude)
  );
}

/**
 * Check if element should be kept based on selector configuration
 */
function shouldKeepElement(
  element: parse5TreeAdapter.Element,
  config: HtmlConfig,
  parentMatchesInclude = false
): boolean {
  // Check exclude selectors first
  if (config.exclude && matchesAnySelector(element, config.exclude)) {
    return false;
  }

  // If no include selectors, keep by default
  if (!config.include || config.include.length === 0) {
    return true;
  }

  // Keep if parent matches include selector
  if (parentMatchesInclude) {
    return true;
  }

  // Keep if matches any include selector
  return matchesAnySelector(element, config.include);
}

/**
 * CSS selector matching (simplified version)
 */
function matchesSelector(
  element: parse5TreeAdapter.Element,
  selector: string
): boolean {
  if (!element || !element.tagName) {
    return false;
  }

  // Tag selector
  if (
    !selector.includes('[') &&
    !selector.includes('.') &&
    !selector.includes('#')
  ) {
    return element.tagName.toLowerCase() === selector.toLowerCase();
  }

  // Class selector
  if (selector.startsWith('.')) {
    const className = selector.slice(1);
    const classAttr = element.attrs.find((attr) => attr.name === 'class');
    return classAttr ? classAttr.value.split(' ').includes(className) : false;
  }

  // ID selector
  if (selector.startsWith('#')) {
    const id = selector.slice(1);
    const idAttr = element.attrs.find((attr) => attr.name === 'id');
    return idAttr ? idAttr.value === id : false;
  }

  // Attribute selector
  if (selector.startsWith('[') && selector.endsWith(']')) {
    const attrContent = selector.slice(1, -1);
    const eqIndex = attrContent.indexOf('=');

    if (eqIndex === -1) {
      // Just attribute existence
      return element.attrs.some((attr) => attr.name === attrContent);
    } else {
      // Attribute with value
      const attrName = attrContent.slice(0, eqIndex);
      const attrValue = attrContent.slice(eqIndex + 1);
      const unquotedValue = attrValue.replace(/^["']|["']$/g, '');
      const attr = element.attrs.find((a) => a.name === attrName);
      return attr ? attr.value === unquotedValue : false;
    }
  }

  return false;
}

/**
 * Check if element matches any of the provided selectors
 */
function matchesAnySelector(
  element: parse5TreeAdapter.Element,
  selectors: string[]
): boolean {
  if (!selectors || selectors.length === 0) return false;

  for (const selector of selectors) {
    if (matchesSelector(element, selector)) {
      return true;
    }
  }
  return false;
}
