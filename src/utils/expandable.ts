import { cssToAncestorXPath } from './xpath.ts';

export const EXPANDABLE_ICON_DESCRIPTIONS = [
  'three horizontal dots (ellipsis/more options)',
  'three vertical dots (kebab menu)',
  'chevron pointing down or right',
  'caret / small triangle arrow',
  'down arrow or right arrow',
  'hamburger icon (three horizontal lines)',
  'plus or minus icon next to a section',
  'filter / funnel icon',
  'gear / settings icon that might open a menu',
  'expand / collapse toggle icon',
];

const ICON_CLASSES = ['dots', 'chevron', 'ellipsis', 'caret', 'arrow', 'expand', 'collapse', 'hamburger', 'more'];
const TRIGGER_CLASSES = ['toggle', 'trigger', 'split', 'popup', 'filter', 'tune'];
const CONTAINER_CLASSES = ['dropdown-trigger', 'dropdown-toggle', 'popover-trigger', 'menu-trigger'];
const CLICKABLE = `@role='button' or self::button or self::a or @tabindex`;
const cc = (classes: string[]) => classes.map((c) => `contains(@class,'${c}')`).join(' or ');

const XPATHS = [`//*[@aria-haspopup or @aria-expanded]`, `//*[(${CLICKABLE}) and .//*[${cc(ICON_CLASSES)}]]`, `//*[${cc(CONTAINER_CLASSES)}]`, `//*[(${CLICKABLE}) and (${cc(TRIGGER_CLASSES)})]`];

export function buildExpandableXPath(excludeContainers: string[] = []): string {
  const exclusions = excludeContainers.map((css) => cssToAncestorXPath(css)).filter(Boolean);
  const predicate = exclusions.length > 0 ? `[not(ancestor::*[${exclusions.join(' or ')}])]` : '';
  return XPATHS.map((x) => `(${x}${predicate})`).join(' | ');
}
