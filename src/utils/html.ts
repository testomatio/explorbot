import dedent from 'dedent';
import { minify } from 'html-minifier-next';
import { parse, parseFragment, serialize } from 'parse5';
import type * as parse5TreeAdapter from 'parse5/lib/tree-adapters/default';
import type { HtmlConfig } from '../config.ts';

/**
 * HTML parsing library that preserves original structure while filtering content
 * Based on CodeceptJS approach but with recursive parsing to maintain structure
 */

/**
 * Simple CSS selector matcher
 * Supports basic selectors: tag, .class, #id, [attr], [attr=value]
 */
function matchesSelector(element: parse5TreeAdapter.Element, selector: string): boolean {
  // Check if it's actually an element with tagName
  if (!element || !element.tagName) {
    return false;
  }

  // Tag selector
  if (!selector.includes('[', '.') && !selector.includes('#') && !selector.includes(':')) {
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
    }
    // Attribute with value
    const attrName = attrContent.slice(0, eqIndex);
    const attrValue = attrContent.slice(eqIndex + 1);
    // Remove quotes if present
    const unquotedValue = attrValue.replace(/^["']|["']$/g, '');
    const attr = element.attrs.find((a) => a.name === attrName);
    return attr ? attr.value === unquotedValue : false;
  }

  return false;
}

/**
 * Check if element matches any of the provided selectors
 */
function matchesAnySelector(element: parse5TreeAdapter.Element, selectors: string[]): boolean {
  if (!selectors || selectors.length === 0) return false;

  for (const selector of selectors) {
    if (matchesSelector(element, selector)) {
      return true;
    }
  }
  return false;
}

const TEXT_ELEMENT_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'td', 'th', 'label', 'div', 'span']);

const INTERACTIVE_TAGS = new Set(['a', 'button', 'details', 'input', 'option', 'select', 'summary', 'textarea', 'iframe']);

const INTERACTIVE_ROLES = new Set(['button', 'checkbox', 'combobox', 'link', 'listbox', 'radio', 'search', 'switch', 'tab', 'textbox']);

const INTERACTIVE_EVENT_ATTRIBUTES = new Set(['onclick', 'onchange', 'onblur', 'onfocus', 'onmousedown', 'onmouseup']);

const HIDDEN_CLASSES = new Set(['hidden', 'invisible', 'd-none', 'hide', 'dn', 'u-hidden', 'is-hidden', 'visually-hidden', 'sr-only', 'screen-reader-only', 'visuallyhidden', 'opacity-0']);

const TAILWIND_CLASS_PATTERNS: RegExp[] = [
  /^m[trblxy]?-/i,
  /^p[trblxy]?-/i,
  /^(min|max)-(w|h)-/i,
  /^(h|w)-/i,
  /^bg-/i,
  /^text-/i,
  /^font-/i,
  /^leading-/i,
  /^tracking-/i,
  /^uppercase$/i,
  /^lowercase$/i,
  /^capitalize$/i,
  /^italic$/i,
  /^antialiased$/i,
  /^subpixel-antialiased$/i,
  /^whitespace-/i,
  /^break-/i,
  /^flex$/i,
  /^inline-flex$/i,
  /^grid$/i,
  /^inline-grid$/i,
  /^items-/i,
  /^content-/i,
  /^justify-/i,
  /^place-/i,
  /^self-/i,
  /^gap-/i,
  /^space-[xy]-/i,
  /^order-/i,
  /^z-/i,
  /^shadow/i,
  /^rounded/i,
  /^border/i,
  /^outline-/i,
  /^ring-/i,
  /^opacity-/i,
  /^fill-/i,
  /^stroke-/i,
  /^blur-/i,
  /^brightness-/i,
  /^contrast-/i,
  /^drop-shadow-/i,
  /^grayscale$/i,
  /^hue-rotate-/i,
  /^invert$/i,
  /^saturate-/i,
  /^sepia$/i,
  /^backdrop-/i,
  /^overflow-/i,
  /^truncate$/i,
  /^transform$/i,
  /^transition$/i,
  /^duration-/i,
  /^delay-/i,
  /^ease-/i,
  /^animate-/i,
  /^cursor-/i,
  /^select-/i,
  /^pointer-events-/i,
  /^align-/i,
  /^table-/i,
  /^list-/i,
  /^grid-cols-/i,
  /^grid-rows-/i,
  /^col-span-/i,
  /^row-span-/i,
  /^translate-[xyz]-/i,
  /^scale-[xyz]?-/i,
  /^rotate-/i,
  /^skew-[xy]-/i,
  /^origin-/i,
  /^inset-/i,
  /^top-/i,
  /^bottom-/i,
  /^left-/i,
  /^right-/i,
  /^aspect-/i,
  /^prose$/i,
];

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

type ParentNodeLike = parse5TreeAdapter.Document | parse5TreeAdapter.DocumentFragment | parse5TreeAdapter.Element;

function hasChildNodes(node: unknown): node is ParentNodeLike {
  return !!node && typeof node === 'object' && 'childNodes' in (node as Record<string, unknown>) && Array.isArray((node as { childNodes?: unknown }).childNodes);
}

function stripElementsByTag(node: ParentNodeLike, tagsToRemove: Set<string>): void {
  if (!node.childNodes) return;

  for (let i = node.childNodes.length - 1; i >= 0; i--) {
    const child = node.childNodes[i];

    if (child.nodeName === '#comment') {
      node.childNodes.splice(i, 1);
      continue;
    }

    if ('tagName' in child && child.tagName) {
      const tagName = child.tagName.toLowerCase();
      if (tagsToRemove.has(tagName)) {
        node.childNodes.splice(i, 1);
        continue;
      }

      stripElementsByTag(child as ParentNodeLike, tagsToRemove);
    } else if (hasChildNodes(child)) {
      stripElementsByTag(child as ParentNodeLike, tagsToRemove);
    }
  }
}

function pruneDocumentHead(document: parse5TreeAdapter.Document): void {
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

    if (child.nodeName === '#text') {
      const textNode = child as parse5TreeAdapter.TextNode;
      if (!textNode.value.trim()) {
        headElement.childNodes.splice(i, 1);
      }
      continue;
    }

    if (child.nodeName === '#comment') {
      headElement.childNodes.splice(i, 1);
      continue;
    }

    headElement.childNodes.splice(i, 1);
  }
}

function sanitizeDocumentTree(document: parse5TreeAdapter.Document): void {
  stripElementsByTag(document, NON_SEMANTIC_TAGS);
  pruneDocumentHead(document);
}

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

function createSanitizedDocument(html: string, _htmlConfig?: HtmlConfig): parse5TreeAdapter.Document {
  const document = parse(html);
  const documentTitle = getDocumentTitle(document);
  sanitizeDocumentTree(document);
  ensureDocumentTitle(document, documentTitle);
  return document;
}

export function sanitizeHtmlDocument(html: string, htmlConfig?: HtmlConfig): parse5TreeAdapter.Document {
  return createSanitizedDocument(html, htmlConfig);
}

export function sanitizeHtmlString(html: string, htmlConfig?: HtmlConfig): string {
  const document = createSanitizedDocument(html, htmlConfig);
  return serialize(document);
}

/**
 * Creates a minimal snapshot keeping only interactive elements and their structure
 * Based on CodeceptJS HTML library
 */
export function htmlMinimalUISnapshot(html: string, htmlConfig?: HtmlConfig['minimal']) {
  const document = parse(html);
  const trashHtmlClasses = /^(text-|color-|flex-|float-|v-|ember-|d-|border-)/;
  const removeElements = ['path', 'script'];

  function isFilteredOut(node) {
    // Check exclude selectors first
    if (htmlConfig?.exclude && matchesAnySelector(node, htmlConfig.exclude)) {
      return true;
    }

    if (removeElements.includes(node.nodeName)) return true;
    if (node.attrs) {
      if (node.attrs.find((attr) => attr.name === 'role' && attr.value === 'tooltip')) return true;
    }
    return false;
  }

  // Define default interactive elements
  const interactiveElements = ['a', 'input', 'button', 'select', 'textarea', 'option', 'iframe'];
  const textElements = ['label', 'h1', 'h2'];
  const allowedRoles = ['button', 'checkbox', 'search', 'textbox', 'tab'];
  const allowedAttrs = ['id', 'for', 'class', 'name', 'type', 'value', 'tabindex', 'aria-labelledby', 'aria-label', 'label', 'placeholder', 'title', 'alt', 'src', 'width', 'height', 'role'];

  function isInteractive(element) {
    // Check if element matches include selectors
    if (htmlConfig?.include && matchesAnySelector(element, htmlConfig.include)) {
      return true;
    }

    // Check if element matches exclude selectors
    if (htmlConfig?.exclude && matchesAnySelector(element, htmlConfig.exclude)) {
      return false;
    }

    // Check for data-explorbot attributes (new addition)
    if (hasExplorbotAttributes(element)) {
      return true;
    }

    // Default logic
    if (element.nodeName === 'input' && element.attrs.find((attr) => attr.name === 'type' && attr.value === 'hidden')) return false;
    if (interactiveElements.includes(element.nodeName)) return true;
    if (element.attrs) {
      if (element.attrs.find((attr) => attr.name === 'contenteditable')) return true;
      if (element.attrs.find((attr) => attr.name === 'tabindex')) return true;
      const role = element.attrs.find((attr) => attr.name === 'role');
      if (role && allowedRoles.includes(role.value)) return true;
    }
    return false;
  }

  function hasMeaningfulText(node) {
    if (textElements.includes(node.nodeName)) return true;
    return false;
  }

  function hasInteractiveDescendant(node) {
    if (!node.childNodes) return false;
    let result = false;

    for (const childNode of node.childNodes) {
      if (isInteractive(childNode) || hasMeaningfulText(childNode)) return true;
      result = result || hasInteractiveDescendant(childNode);
    }

    return result;
  }

  function removeNonInteractive(node) {
    if (node.nodeName !== '#document') {
      const parent = node.parentNode;
      const index = parent.childNodes.indexOf(node);

      if (isFilteredOut(node)) {
        parent.childNodes.splice(index, 1);
        return true;
      }

      // keep texts for interactive elements
      if ((isInteractive(parent) || hasMeaningfulText(parent)) && node.nodeName === '#text') {
        node.value = node.value.trim().slice(0, 200);
        if (!node.value) return false;
        return true;
      }

      if (
        // if parent is interactive, we may need child element to match
        !isInteractive(parent) &&
        !isInteractive(node) &&
        !hasInteractiveDescendant(node) &&
        !hasMeaningfulText(node)
      ) {
        parent.childNodes.splice(index, 1);
        return true;
      }
    }

    if (node.attrs) {
      // Filter and keep allowed attributes, accessibility attributes
      node.attrs = node.attrs.filter((attr) => {
        const { name, value } = attr;
        if (name === 'class') {
          // Remove classes containing digits
          attr.value = value
            .split(' ')
            // remove classes containing digits/
            .filter((className) => !/\d/.test(className))
            // remove popular trash classes
            .filter((className) => !className.match(trashHtmlClasses))
            // remove classes with : and __ in them
            .filter((className) => !className.match(/(:|__)/))
            // remove tailwind utility classes
            .filter((className) => !TAILWIND_CLASS_PATTERNS.some((pattern) => pattern.test(className)))
            .join(' ');
        }

        return allowedAttrs.includes(name) || name.startsWith('data-explorbot-');
      });
    }

    // Convert data-explorbot-* attributes to regular attributes
    if (node.attrs) {
      convertExplorbotAttributes(node);
    }

    if (node.childNodes) {
      for (let i = node.childNodes.length - 1; i >= 0; i--) {
        const childNode = node.childNodes[i];
        removeNonInteractive(childNode);
      }
    }
    return false;
  }

  // Remove non-interactive elements starting from the root element
  removeNonInteractive(document);

  // Serialize the modified document tree back to HTML
  const serializedHTML = serialize(document);

  return serializedHTML;
}

export async function minifyHtml(html: string): Promise<string> {
  return await minify(html, {
    collapseWhitespace: true,
    removeComments: true,
    removeEmptyElements: false,
    removeOptionalTags: false,
  });
}

/**
 * Creates a combined snapshot with interactive elements and meaningful text
 * Preserves original HTML structure
 */
export function htmlCombinedSnapshot(html: string, htmlConfig?: HtmlConfig['combined']): string {
  const shouldKeepWithConfig = (element: parse5TreeAdapter.Element) => {
    return shouldKeepCombined(element, htmlConfig);
  };

  const document = createSanitizedDocument(html);
  const body = findBody(document);
  if (!body) return html;

  filterTree(body, shouldKeepWithConfig);
  cleanAllElements(body);

  return serialize(document);
}

/**
 * Creates text-only snapshot with markdown formatting
 */
export function htmlTextSnapshot(html: string, htmlConfig?: HtmlConfig['text']): string {
  const document = createSanitizedDocument(html);
  const body = findBody(document);
  if (!body) return '';

  const text = processHtmlForText(body, htmlConfig);
  return text.trim();
}

function processHtmlForText(element: parse5TreeAdapter.Element, htmlConfig?: HtmlConfig['text']): string {
  const lines: string[] = [];

  // Helper function to check if element matches include/exclude selectors
  const shouldIncludeElement = (el: parse5TreeAdapter.Element): boolean => {
    if (!htmlConfig) return true;

    // If element matches any exclude selector, don't include it
    if (htmlConfig.exclude && matchesAnySelector(el, htmlConfig.exclude)) {
      return false;
    }

    // If no include selectors, include by default
    if (!htmlConfig.include || htmlConfig.include.length === 0) {
      return true;
    }

    // Include if matches any include selector
    return matchesAnySelector(el, htmlConfig.include);
  };

  const processNode = (node: parse5TreeAdapter.Node): void => {
    if (node.nodeName === '#text') {
      // For text nodes, check if parent element should be included
      if (node.parentNode && 'tagName' in node.parentNode) {
        const parentElement = node.parentNode as parse5TreeAdapter.Element;
        if (!shouldIncludeElement(parentElement)) {
          return;
        }
      }

      const text = (node as parse5TreeAdapter.TextNode).value.trim();
      if (text.length >= 5) {
        lines.push(text);
      }
      return;
    }

    if ('tagName' in node) {
      const element = node as parse5TreeAdapter.Element;
      const tagName = element.tagName.toLowerCase();

      // Skip style and script elements completely
      if (['style', 'script'].includes(tagName)) {
        return;
      }

      // Check if element should be included based on configuration
      if (!shouldIncludeElement(element)) {
        // Still process children in case they should be included
        element.childNodes.forEach((child) => processNode(child));
        return;
      }

      // Handle headers specially - they should always be processed as markdown
      if (tagName.startsWith('h')) {
        const text = getTextContent(element).trim();
        if (text) {
          switch (tagName) {
            case 'h1':
              lines.push(`# ${text}`);
              break;
            case 'h2':
              lines.push(`## ${text}`);
              break;
            case 'h3':
              lines.push(`### ${text}`);
              break;
            case 'h4':
              lines.push(`#### ${text}`);
              break;
            case 'h5':
              lines.push(`##### ${text}`);
              break;
            case 'h6':
              lines.push(`###### ${text}`);
              break;
          }
        }
        return;
      }

      // Handle interactive elements specially
      if (shouldKeepInteractive(element)) {
        // Format buttons and links
        if (tagName === 'button' || getAttribute(element, 'role') === 'button') {
          const buttonText = getTextContent(element).trim();
          if (buttonText) {
            lines.push(`[${buttonText}]`);
          } else {
            lines.push('[Button]');
          }
          return;
        }

        if (tagName === 'a' || getAttribute(element, 'role') === 'link') {
          const linkText = getTextContent(element).trim();
          if (linkText) {
            lines.push(`[${linkText}]`);
          } else {
            lines.push('[Link]');
          }
          return;
        }

        // Format input fields
        if (tagName === 'input') {
          const name = getAttribute(element, 'name') || getAttribute(element, 'id');
          const placeholder = getAttribute(element, 'placeholder');
          const type = getAttribute(element, 'type');

          if (type === 'submit' || type === 'button' || type === 'reset') {
            const value = getAttribute(element, 'value') || type;
            lines.push(`[${value}]`);
          } else if (placeholder) {
            lines.push(`{${placeholder}}`);
          } else if (name) {
            lines.push(`{${name}}`);
          } else {
            lines.push('{Input}');
          }
          return;
        }

        // Format textarea fields
        if (tagName === 'textarea') {
          const name = getAttribute(element, 'name') || getAttribute(element, 'id');
          const placeholder = getAttribute(element, 'placeholder');

          if (placeholder) {
            lines.push(`{${placeholder}}`);
          } else if (name) {
            lines.push(`{${name}}`);
          } else {
            lines.push('{Textarea}');
          }
          return;
        }

        // Format select fields
        if (tagName === 'select') {
          const name = getAttribute(element, 'name') || getAttribute(element, 'id');

          if (name) {
            lines.push(`{${name}}`);
          } else {
            lines.push('{Select}');
          }
          return;
        }

        // For other interactive elements, just process children
        element.childNodes.forEach((child) => processNode(child));
        return;
      }

      // Handle text elements (but not headers - they're handled above)
      if (TEXT_ELEMENT_TAGS.has(tagName) && !tagName.startsWith('h')) {
        // Only get direct text content, not from descendants
        const directText = element.childNodes
          .filter((child) => child.nodeName === '#text')
          .map((child) => (child as parse5TreeAdapter.TextNode).value)
          .join('')
          .trim();

        // Filter by length (5 chars minimum)
        if (directText.length < 5) {
          // Still process children
          element.childNodes.forEach((child) => processNode(child));
          return;
        }

        if (tagName === 'li' || tagName === 'label') {
          switch (tagName) {
            case 'li': {
              // Handle nested lists
              const indent = hasListParent(element) ? '  ' : '';
              // Get all text content for list items (including descendants)
              const fullText = getTextContent(element).trim();
              lines.push(`${indent}- ${fullText}`);
              break;
            }
            case 'label':
              lines.push(`**${directText}**`);
              break;
          }
          return;
        }

        // For other text elements, check if we should add them
        if (!hasTextAncestor(element)) {
          lines.push(directText);
        }

        // Always process children
        element.childNodes.forEach((child) => processNode(child));
        return;
      }
      // Process children of non-text elements
      element.childNodes.forEach((child) => processNode(child));
    }
  };

  processNode(element);

  // Clean up spacing and trim whitespace
  let result = lines.join('\n\n');

  // Add some structure for better readability
  // Ensure headers have proper spacing
  result = result.replace(/^(#{1,6} .+)$/gm, '\n$1\n');

  // Ensure form elements are grouped with proper spacing
  result = result.replace(/(\{[^}]+\}| \[[^\]]+\])/g, '\n$1');

  // Clean up excessive empty lines
  result = result.replace(/\n{3,}/g, '\n\n');

  // Trim leading/trailing whitespace
  result = result.trim();

  return result;
}

// Helper functions

function findBody(document: parse5TreeAdapter.Document): parse5TreeAdapter.Element | null {
  const html = document.childNodes.find((node) => node.nodeName === 'html');
  if (!html || !('childNodes' in html)) return null;

  return (html.childNodes.find((node) => node.nodeName === 'body') as parse5TreeAdapter.Element) || null;
}

function shouldKeepInteractive(element: parse5TreeAdapter.Element, selectorConfig?: { include?: string[]; exclude?: string[] }): boolean {
  if (hasHiddenClass(element)) return false;

  if (selectorConfig?.include && matchesAnySelector(element, selectorConfig.include)) {
    return true;
  }

  if (selectorConfig?.exclude && matchesAnySelector(element, selectorConfig.exclude)) {
    return false;
  }

  if (hasExplorbotAttributes(element)) return true;

  const tagName = element.tagName.toLowerCase();
  if (tagName === 'input') {
    const type = getAttribute(element, 'type');
    if (type && type.toLowerCase() === 'hidden') return false;
  }

  if (INTERACTIVE_TAGS.has(tagName)) return true;

  const role = getAttribute(element, 'role');
  if (role && INTERACTIVE_ROLES.has(role.toLowerCase())) return true;

  for (const attr of element.attrs ?? []) {
    const attrName = attr.name.toLowerCase();
    if (INTERACTIVE_EVENT_ATTRIBUTES.has(attrName)) return true;
    if (attrName === 'contenteditable') return true;
    if (attrName === 'tabindex') return true;
  }

  return false;
}

function shouldKeepCombined(element: parse5TreeAdapter.Element, htmlConfig?: HtmlConfig['combined']): boolean {
  if (hasHiddenClass(element)) return false;

  if (htmlConfig?.include && matchesAnySelector(element, htmlConfig.include)) {
    return true;
  }

  if (htmlConfig?.exclude && matchesAnySelector(element, htmlConfig.exclude)) {
    return false;
  }

  if (hasExplorbotAttributes(element)) return true;

  if (getAttribute(element, 'role')) return true;

  if (shouldKeepInteractive(element, htmlConfig)) return true;

  const tagName = element.tagName.toLowerCase();
  if (TEXT_ELEMENT_TAGS.has(tagName)) {
    if (tagName.startsWith('h')) return true;
    const text = getTextContent(element).trim();
    if (text.length <= 5) return false;
    return true;
  }

  return hasKeepableChildren(element, htmlConfig);
}

function hasKeepableChildren(element: parse5TreeAdapter.Element, htmlConfig?: HtmlConfig['combined']): boolean {
  if (!element.childNodes) return false;

  for (const child of element.childNodes) {
    if ('tagName' in child) {
      if (shouldKeepCombined(child as parse5TreeAdapter.Element, htmlConfig)) {
        return true;
      }
    } else if (child.nodeName === '#text') {
      // Also consider direct text content
      const text = (child as parse5TreeAdapter.TextNode).value.trim();
      if (text.length >= 5) {
        return true;
      }
    }
  }

  return false;
}

function hasTextAncestor(element: parse5TreeAdapter.Element): boolean {
  let parent = element.parentNode;

  while (parent && 'tagName' in parent) {
    const parentElement = parent as parse5TreeAdapter.Element;
    const parentTagName = parentElement.tagName.toLowerCase();

    if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'p', 'td', 'th', 'label'].includes(parentTagName)) {
      return true;
    }

    parent = parent.parentNode;
  }

  return false;
}

function hasListParent(element: parse5TreeAdapter.Element): boolean {
  let parent = element.parentNode;

  while (parent && 'tagName' in parent) {
    if (parent.parentNode && 'tagName' in parent.parentNode) {
      const grandParent = parent.parentNode as parse5TreeAdapter.Element;
      const grandParentTagName = grandParent.tagName.toLowerCase();

      if (['ul', 'ol'].includes(grandParentTagName)) {
        return true;
      }
    }

    parent = parent.parentNode;
  }

  return false;
}

function isInteractiveContainer(element: parse5TreeAdapter.Element): boolean {
  const tagName = element.tagName.toLowerCase();
  if (tagName === 'button') return true;
  if (getAttribute(element, 'role')) return true;
  return false;
}

function filterTree(element: parse5TreeAdapter.Element, shouldKeep: (el: parse5TreeAdapter.Element) => boolean): boolean {
  if (!element.childNodes) return false;

  const isInteractive = isInteractiveContainer(element);
  let hasKeepableElementChildren = false;
  let hasTextContent = false;
  const children = [...element.childNodes];

  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i];

    if ('tagName' in child) {
      const childElement = child as parse5TreeAdapter.Element;
      const childHasContent = filterTree(childElement, shouldKeep);

      if (isInteractive) {
        hasKeepableElementChildren = true;
        cleanElement(childElement);
        continue;
      }

      if (!shouldKeep(childElement)) {
        if (hasHiddenClass(childElement) || !childHasContent) {
          const index = element.childNodes.indexOf(child);
          if (index > -1) {
            element.childNodes.splice(index, 1);
          }
        } else {
          hasKeepableElementChildren = true;
        }
        continue;
      }

      hasKeepableElementChildren = true;
      cleanElement(childElement);
    } else if (child.nodeName === '#text') {
      const text = (child as parse5TreeAdapter.TextNode).value.trim();
      if (text.length > 0) {
        hasTextContent = true;
      } else {
        const index = element.childNodes.indexOf(child);
        if (index > -1) {
          element.childNodes.splice(index, 1);
        }
      }
    }
  }

  if (shouldKeep(element)) {
    return true;
  }

  if (hasKeepableElementChildren) {
    return true;
  }

  const tagName = element.tagName.toLowerCase();
  const isTextElement = TEXT_ELEMENT_TAGS.has(tagName);
  if (isTextElement && hasTextContent) {
    const text = getTextContent(element).trim();
    return text.length > 5;
  }

  return hasTextContent;
}

function cleanAllElements(element: parse5TreeAdapter.Element): void {
  cleanElement(element);

  if (!element.childNodes) return;

  for (const child of element.childNodes) {
    if ('tagName' in child) {
      cleanAllElements(child as parse5TreeAdapter.Element);
    }
  }
}

function cleanElement(element: parse5TreeAdapter.Element): void {
  const keepAttrs = [
    'id',
    'class',
    'name',
    'type',
    'value',
    'placeholder',
    'aria-label',
    'aria-labelledby',
    'aria-describedby',
    'aria-owns',
    'role',
    'title',
    'href',
    'src',
    'tabindex',
    'contenteditable',
    'onclick',
    'onmousedown',
    'onmouseup',
    'onchange',
    'onfocus',
    'required',
    'disabled',
    'checked',
    'selected',
    'action',
    'key',
    'label',
    'important',
  ];

  convertExplorbotAttributes(element);

  element.attrs = element.attrs.filter((attr) => keepAttrs.includes(attr.name) || attr.name.startsWith('data-explorbot-'));

  for (const attr of element.attrs) {
    if (attr.name === 'class') {
      attr.value = attr.value
        .split(/\s+/)
        .filter((className) => !/\d/.test(className))
        .filter((className) => !TAILWIND_CLASS_PATTERNS.some((pattern) => pattern.test(className)))
        .join(' ');

      if (!attr.value) {
        element.attrs = element.attrs.filter((a) => a.name !== 'class');
      }
    }
  }

  if (element.tagName.toLowerCase() === 'script') {
    element.childNodes = [];
  }
}

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
  return text.trim();
}

function getAttribute(element: parse5TreeAdapter.Element, name: string): string | undefined {
  const attr = element.attrs.find((a) => a.name === name);
  return attr?.value;
}

function hasHiddenClass(element: parse5TreeAdapter.Element): boolean {
  const classAttr = element.attrs.find((attr) => attr.name === 'class');
  if (!classAttr) return false;

  const classes = classAttr.value.split(/\s+/);
  return classes.some((className) => HIDDEN_CLASSES.has(className));
}

/**
 * Check if element has any data-explorbot-* attributes
 */
function hasExplorbotAttributes(element: parse5TreeAdapter.Element): boolean {
  return element.attrs?.some((attr) => attr.name.startsWith('data-explorbot-'));
}

/**
 * Convert data-explorbot-* attributes to regular attributes
 * e.g., data-explorbot-value becomes value
 */
function convertExplorbotAttributes(element: parse5TreeAdapter.Element): void {
  const explorbotAttrs: Array<{ name: string; value: string }> = [];

  // Find all data-explorbot-* attributes
  element.attrs = element.attrs.filter((attr) => {
    if (attr.name.startsWith('data-explorbot-')) {
      const regularName = attr.name.replace('data-explorbot-', '');
      explorbotAttrs.push({ name: regularName, value: attr.value });
      return false; // Remove the data-explorbot-* attribute
    }
    return true; // Keep other attributes
  });

  // Add converted attributes
  element.attrs.push(...explorbotAttrs);
}

export interface ExtractedLink {
  title: string;
  url: string;
}

export function extractLinks(html: string): ExtractedLink[] {
  const document = parseFragment(html);
  const links: ExtractedLink[] = [];
  const seen = new Set<string>();

  const skipPrefixes = ['javascript:', 'mailto:', 'tel:', '#'];

  function traverseNodes(node: parse5TreeAdapter.Node): void {
    if ('tagName' in node) {
      const element = node as parse5TreeAdapter.Element;
      const tagName = element.tagName.toLowerCase();

      if (tagName === 'a') {
        const href = getAttribute(element, 'href');
        if (href) {
          const shouldSkip = skipPrefixes.some((prefix) => href.startsWith(prefix));
          if (!shouldSkip) {
            const title = getAttribute(element, 'aria-label') || getTextContent(element).trim();
            if (title && title.length <= 100) {
              const key = `${href}|${title}`;
              if (!seen.has(key)) {
                seen.add(key);
                links.push({ title, url: href });
              }
            }
          }
        }
      }
    }

    if ('childNodes' in node) {
      for (const child of node.childNodes) {
        traverseNodes(child);
      }
    }
  }

  traverseNodes(document);

  return links;
}

export function extractHeadings(html: string): {
  h1?: string;
  h2?: string;
  h3?: string;
  h4?: string;
} {
  const document = parseFragment(html);
  const headings: { h1: string[]; h2: string[]; h3: string[]; h4: string[] } = {
    h1: [],
    h2: [],
    h3: [],
    h4: [],
  };

  function traverseNodes(node: parse5TreeAdapter.Node): void {
    if ('tagName' in node) {
      const element = node as parse5TreeAdapter.Element;
      const tagName = element.tagName.toLowerCase();

      if (tagName === 'h1' || tagName === 'h2' || tagName === 'h3' || tagName === 'h4') {
        const text = getTextContent(element).trim();
        if (text) {
          headings[tagName as 'h1' | 'h2' | 'h3' | 'h4'].push(text);
        }
      }
    }

    if ('childNodes' in node) {
      for (const child of node.childNodes) {
        traverseNodes(child);
      }
    }
  }

  traverseNodes(document);

  const result: { h1?: string; h2?: string; h3?: string; h4?: string } = {};

  if (headings.h1.length > 0) {
    result.h1 = headings.h1.join(' | ');
  }
  if (headings.h2.length > 0) {
    result.h2 = headings.h2.join(' | ');
  }
  if (headings.h3.length > 0) {
    result.h3 = headings.h3.join(' | ');
  }
  if (headings.h4.length > 0) {
    result.h4 = headings.h4.join(' | ');
  }

  return result;
}

export function codeToMarkdown(code: string): string {
  return `
\`\`\`
${code}
\`\`\`
  `;
}

export function isBodyEmpty(html: string): boolean {
  if (!html) return true;
  const bodyMatch = html.match(/<body[^>]*>(.*?)<\/body>/is);
  if (!bodyMatch) return true;
  const bodyContent = bodyMatch[1].trim();
  return bodyContent === '';
}

/**
 * Extract HTML snippet around a targeted element based on locator
 * Used for accessibility analysis to show what element was being targeted
 */
export function extractTargetedHtml(html: string, locator: string): string {
  if (!html || !locator) return '';

  const searchTerms: string[] = [];

  // XPath locator
  if (locator.startsWith('//') || locator.startsWith('(//')) {
    const textMatch = locator.match(/text\(\)\s*=\s*['"]([^'"]+)['"]/i);
    if (textMatch) searchTerms.push(textMatch[1]);

    const attrMatch = locator.match(/@[\w-]+\s*=\s*['"]([^'"]+)['"]/g);
    if (attrMatch) {
      for (const match of attrMatch) {
        const valueMatch = match.match(/['"]([^'"]+)['"]/);
        if (valueMatch) searchTerms.push(valueMatch[1]);
      }
    }
  } else if (locator.startsWith('{')) {
    // JSON locator (Playwright-style)
    try {
      const parsed = JSON.parse(locator);
      if (parsed.text) searchTerms.push(parsed.text);
      if (parsed.name) searchTerms.push(parsed.name);
    } catch {}
  } else {
    // CSS selector or text
    const cleanLoc = locator.replace(/['"]/g, '');
    if (!cleanLoc.startsWith('.') && !cleanLoc.startsWith('#') && !cleanLoc.includes('[')) {
      searchTerms.push(cleanLoc);
    }
    const classMatch = cleanLoc.match(/\.([a-zA-Z0-9_-]+)/);
    if (classMatch) searchTerms.push(classMatch[1]);
    const idMatch = cleanLoc.match(/#([a-zA-Z0-9_-]+)/);
    if (idMatch) searchTerms.push(idMatch[1]);
  }

  for (const term of searchTerms) {
    if (term.length < 2) continue;
    const idx = html.indexOf(term);
    if (idx === -1) continue;

    const start = Math.max(0, html.lastIndexOf('<', idx));
    let depth = 0;
    let end = start;
    for (let i = start; i < html.length && i < start + 1000; i++) {
      if (html[i] === '<' && html[i + 1] !== '/') depth++;
      if (html[i] === '<' && html[i + 1] === '/') depth--;
      if (depth === 0 && html[i] === '>') {
        end = i + 1;
        break;
      }
    }
    const snippet = html.slice(start, Math.min(end, start + 500));
    return snippet.trim();
  }

  return '';
}
