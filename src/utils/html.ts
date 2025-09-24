import { parse, parseFragment, serialize } from 'parse5';
import type * as parse5TreeAdapter from 'parse5/lib/tree-adapters/default';
import type { HtmlConfig } from '../config.ts';

/**
 * HTML parsing library that preserves original structure while filtering content
 * Based on CodeceptJS approach but with recursive parsing to maintain structure
 */

const INTERACTIVE_SELECTORS = [
  'a',
  'button',
  'input',
  'select',
  'textarea',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="textbox"]',
  '[role="switch"]',
  '[role="tab"]',
  '[onclick]',
  '[onmousedown]',
  '[onmouseup]',
  '[onchange]',
  '[onfocus]',
  '[onblur]',
  'details',
  'summary',
];

/**
 * Simple CSS selector matcher
 * Supports basic selectors: tag, .class, #id, [attr], [attr=value]
 */
function matchesSelector(
  element: parse5TreeAdapter.Element,
  selector: string
): boolean {
  // Check if it's actually an element with tagName
  if (!element || !element.tagName) {
    return false;
  }

  // Tag selector
  if (
    !selector.includes('[', '.') &&
    !selector.includes('#') &&
    !selector.includes(':')
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
      // Remove quotes if present
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

const TEXT_ELEMENT_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'li',
  'td',
  'th',
  'label',
  'div',
  'span',
]);

/**
 * Creates a minimal snapshot keeping only interactive elements and their structure
 * Based on CodeceptJS HTML library
 */
export function htmlMinimalUISnapshot(
  html: string,
  htmlConfig?: HtmlConfig['minimal']
) {
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
      if (
        node.attrs.find(
          (attr) => attr.name === 'role' && attr.value === 'tooltip'
        )
      )
        return true;
    }
    return false;
  }

  // Define default interactive elements
  const interactiveElements = [
    'a',
    'input',
    'button',
    'select',
    'textarea',
    'option',
  ];
  const textElements = ['label', 'h1', 'h2'];
  const allowedRoles = ['button', 'checkbox', 'search', 'textbox', 'tab'];
  const allowedAttrs = [
    'id',
    'for',
    'class',
    'name',
    'type',
    'value',
    'tabindex',
    'aria-labelledby',
    'aria-label',
    'label',
    'placeholder',
    'title',
    'alt',
    'src',
    'role',
  ];

  function isInteractive(element) {
    // Check if element matches include selectors
    if (
      htmlConfig?.include &&
      matchesAnySelector(element, htmlConfig.include)
    ) {
      return true;
    }

    // Check if element matches exclude selectors
    if (
      htmlConfig?.exclude &&
      matchesAnySelector(element, htmlConfig.exclude)
    ) {
      return false;
    }

    // Default logic
    if (
      element.nodeName === 'input' &&
      element.attrs.find(
        (attr) => attr.name === 'type' && attr.value === 'hidden'
      )
    )
      return false;
    if (interactiveElements.includes(element.nodeName)) return true;
    if (element.attrs) {
      if (element.attrs.find((attr) => attr.name === 'contenteditable'))
        return true;
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
      if (
        (isInteractive(parent) || hasMeaningfulText(parent)) &&
        node.nodeName === '#text'
      ) {
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
            .join(' ');
        }

        return allowedAttrs.includes(name);
      });
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

/**
 * Creates a combined snapshot with interactive elements and meaningful text
 * Preserves original HTML structure
 */
export function htmlCombinedSnapshot(
  html: string,
  htmlConfig?: HtmlConfig['combined']
): string {
  // Create a shouldKeep function that captures the config
  const shouldKeepWithConfig = (element: parse5TreeAdapter.Element) => {
    return shouldKeepCombined(element, htmlConfig);
  };

  // Check if html is a fragment (no html/body tags)
  if (!html.includes('<html') && !html.includes('<body')) {
    // Parse as fragment
    const fragment = parseFragment(html);
    filterTree(fragment as parse5TreeAdapter.Element, shouldKeepWithConfig);
    truncateTextInTree(fragment as parse5TreeAdapter.Element, 270); // Adjusted to ensure total with "..." is ≤303
    return serialize(fragment);
  }

  const document = parse(html);
  const body = findBody(document);
  if (!body) return html;

  // Recursively filter the tree
  filterTree(body, shouldKeepWithConfig);

  // Truncate text content in remaining elements
  truncateTextInTree(body, 270); // Adjusted to ensure total with "..." is ≤303

  return serialize(document);
}

/**
 * Creates text-only snapshot with markdown formatting
 */
export function htmlTextSnapshot(
  html: string,
  htmlConfig?: HtmlConfig['text']
): string {
  // Check if html is a fragment (no html/body tags)
  const trimmedHtml = html.trim();
  if (!trimmedHtml.startsWith('<html') && !trimmedHtml.includes('<body')) {
    const fragment = parseFragment(html);
    const text = processHtmlForText(
      fragment as parse5TreeAdapter.Element,
      htmlConfig
    );
    return text.trim();
  }

  const document = parse(html);
  const body = findBody(document);
  if (!body) return '';

  const text = processHtmlForText(body, htmlConfig);
  return text.trim();
}

function processHtmlForText(
  element: parse5TreeAdapter.Element,
  htmlConfig?: HtmlConfig['text']
): string {
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
        if (
          tagName === 'button' ||
          getAttribute(element, 'role') === 'button'
        ) {
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
          const name =
            getAttribute(element, 'name') || getAttribute(element, 'id');
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
          const name =
            getAttribute(element, 'name') || getAttribute(element, 'id');
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
          const name =
            getAttribute(element, 'name') || getAttribute(element, 'id');

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
            case 'li':
              // Handle nested lists
              const indent = hasListParent(element) ? '  ' : '';
              // Get all text content for list items (including descendants)
              const fullText = getTextContent(element).trim();
              lines.push(`${indent}- ${fullText}`);
              break;
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
      } else {
        // Process children of non-text elements
        element.childNodes.forEach((child) => processNode(child));
      }
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

function shouldKeepInteractive(element: parse5TreeAdapter.Element): boolean {
  const tagName = element.tagName.toLowerCase();

  // Check for interactive tags
  if (
    [
      'a',
      'button',
      'input',
      'select',
      'textarea',
      'details',
      'summary',
    ].includes(tagName)
  ) {
    return true;
  }

  // Check for interactive roles
  const role = getAttribute(element, 'role');
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
    ].includes(role.toLowerCase())
  ) {
    return true;
  }

  // Check for interactive attributes
  for (const attr of element.attrs) {
    if (
      [
        'onclick',
        'onmousedown',
        'onmouseup',
        'onchange',
        'onfocus',
        'onblur',
      ].includes(attr.name.toLowerCase())
    ) {
      return true;
    }
  }

  return false;
}

function shouldKeepCombined(
  element: parse5TreeAdapter.Element,
  htmlConfig?: HtmlConfig['combined']
): boolean {
  // Check include selectors first
  if (htmlConfig?.include && matchesAnySelector(element, htmlConfig.include)) {
    return true;
  }

  // Check exclude selectors
  if (htmlConfig?.exclude && matchesAnySelector(element, htmlConfig.exclude)) {
    return false;
  }

  // Keep if interactive
  if (shouldKeepInteractive(element)) return true;

  // Keep if it's a text element with sufficient content (headers are always kept)
  const tagName = element.tagName.toLowerCase();
  if (TEXT_ELEMENT_TAGS.has(tagName)) {
    if (tagName.startsWith('h')) return true; // Always keep headers
    const text = getTextContent(element).trim();
    if (text.length <= 5) return false; // Filter short text
    return true;
  }

  // Keep if it might contain interactive or text elements
  return hasKeepableChildren(element);
}

function hasKeepableChildren(element: parse5TreeAdapter.Element): boolean {
  if (!element.childNodes) return false;

  for (const child of element.childNodes) {
    if ('tagName' in child) {
      if (shouldKeepCombined(child as parse5TreeAdapter.Element)) {
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

    if (
      [
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'li',
        'p',
        'td',
        'th',
        'label',
      ].includes(parentTagName)
    ) {
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

function filterTree(
  element: parse5TreeAdapter.Element,
  shouldKeep: (el: parse5TreeAdapter.Element) => boolean
): boolean {
  if (!element.childNodes) return false;

  let hasKeepableContent = false;
  const children = [...element.childNodes];

  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i];

    if ('tagName' in child) {
      const childElement = child as parse5TreeAdapter.Element;
      const childHasContent = filterTree(childElement, shouldKeep);

      // Check if this element should be removed
      // Special case: for combined snapshot, remove text elements with short content
      if (!shouldKeep(childElement)) {
        // For htmlCombinedSnapshot, check if this is a text element that should be filtered
        const tagName = childElement.tagName.toLowerCase();
        const isTextElement = TEXT_ELEMENT_TAGS.has(tagName);
        const isHeader = tagName.startsWith('h');

        if (isTextElement && !isHeader) {
          const text = getTextContent(childElement).trim();
          if (text.length <= 5) {
            // Remove this element even if it has content
            const index = element.childNodes.indexOf(child);
            if (index > -1) {
              element.childNodes.splice(index, 1);
            }
            continue;
          }
        }

        // If not a text element or it passed the length check, check if it has keepable content
        if (!childHasContent) {
          const index = element.childNodes.indexOf(child);
          if (index > -1) {
            element.childNodes.splice(index, 1);
          }
          continue;
        }
      }

      hasKeepableContent = true;
      cleanElement(childElement);
    } else if (child.nodeName === '#text') {
      const text = (child as parse5TreeAdapter.TextNode).value.trim();
      if (text.length > 0) {
        hasKeepableContent = true;
      } else {
        // Remove empty text nodes
        const index = element.childNodes.indexOf(child);
        if (index > -1) {
          element.childNodes.splice(index, 1);
        }
      }
    }
  }

  return hasKeepableContent || shouldKeep(element);
}

function cleanElement(element: parse5TreeAdapter.Element): void {
  // Keep only important attributes
  const keepAttrs = [
    'id',
    'name',
    'type',
    'value',
    'placeholder',
    'aria-label',
    'aria-labelledby',
    'aria-describedby',
    'role',
    'title',
    'href',
    'onclick',
    'onmousedown',
    'onmouseup',
    'onchange',
    'onfocus',
    'required',
    'disabled',
    'checked',
    'selected',
  ];

  element.attrs = element.attrs.filter((attr) => keepAttrs.includes(attr.name));

  // Add data-codecept-path for CodeceptJS compatibility
  if (!getAttribute(element, 'data-codecept-path')) {
    element.attrs.push({
      name: 'data-codecept-path',
      value: getElementPath(element),
    });
  }

  // Clean script tags
  if (element.tagName.toLowerCase() === 'script') {
    element.childNodes = [];
  }
}

function truncateTextInTree(
  element: parse5TreeAdapter.Element,
  maxLength: number
): void {
  const truncateNode = (
    node: parse5TreeAdapter.Node,
    remaining: number
  ): number => {
    if (remaining <= 0) return 0;

    if (node.nodeName === '#text') {
      const textNode = node as parse5TreeAdapter.TextNode;
      const text = textNode.value;

      if (text.length <= remaining) {
        return text.length;
      }

      // Truncate this text node
      textNode.value = text.substring(0, remaining - 3) + '...';
      return remaining;
    }

    if ('childNodes' in node) {
      const element = node as parse5TreeAdapter.Element;
      let used = 0;

      for (const child of element.childNodes) {
        const childUsed = truncateNode(child, remaining - used);
        used += childUsed;

        if (used >= remaining) {
          // Remove remaining siblings
          const index = element.childNodes.indexOf(child);
          element.childNodes.splice(index + 1);
          break;
        }
      }

      return used;
    }

    return 0;
  };

  truncateNode(element, maxLength);
}

function findTextElementsForTruncation(
  element: parse5TreeAdapter.Element
): parse5TreeAdapter.Element[] {
  const result: parse5TreeAdapter.Element[] = [];

  if (!element || !element.tagName) return result;

  const tagName = element.tagName.toLowerCase();
  if (TEXT_ELEMENT_TAGS.has(tagName) && !shouldKeepInteractive(element)) {
    result.push(element);
  }

  if (element.childNodes) {
    element.childNodes.forEach((child) => {
      if ('tagName' in child) {
        result.push(
          ...findTextElementsForTruncation(child as parse5TreeAdapter.Element)
        );
      }
    });
  }

  return result;
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

function getAttribute(
  element: parse5TreeAdapter.Element,
  name: string
): string | undefined {
  const attr = element.attrs.find((a) => a.name === name);
  return attr?.value;
}

function getElementPath(element: parse5TreeAdapter.Element): string {
  const path: string[] = [];
  let current: parse5TreeAdapter.Element | null = element;

  while (current && 'tagName' in current) {
    let selector = current.tagName.toLowerCase();

    const id = getAttribute(current, 'id');
    if (id) {
      selector += `#${id}`;
    } else {
      // Calculate nth-child
      if (current.parentNode && 'childNodes' in current.parentNode) {
        const siblings = current.parentNode.childNodes.filter(
          (n) =>
            'tagName' in n &&
            (n as parse5TreeAdapter.Element).tagName === current.tagName
        );
        const index = siblings.indexOf(current);
        if (index > 0) {
          selector += `:nth-of-type(${index + 1})`;
        }
      }
    }

    path.unshift(selector);
    current = current.parentNode as parse5TreeAdapter.Element;
  }

  return path.join(' > ');
}
