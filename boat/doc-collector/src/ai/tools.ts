import { type ResearchElement, parseResearchSections } from '../../../../src/ai/researcher/parser.ts';
import type Explorer from '../../../../src/explorer.ts';
import type { WebPageState } from '../../../../src/state-manager.ts';

export interface DocStateTransition {
  action: string;
  before: string;
  after: string;
  targetUrl?: string;
  discoveredUrls?: string[];
  newCapabilities?: string[];
}

interface InteractionCandidate {
  element: ResearchElement;
  container?: string;
  kind: 'detail' | 'category' | 'account' | 'button' | 'pagination' | 'tab';
  sectionName: string;
}

const MAX_PRIMARY_CANDIDATES = 3;
const MAX_INTERACTIONS = 5;
const MAX_LINKS = 15;
const DEFAULT_WAIT_MS = 700;
const TAB_WAIT_MS = 500;

const CATEGORY_LABELS = new Set(['серіали', 'мультсеріали', 'фільми', 'мультфільми', 'добірки', 'аніме', 'дорами', 'collections', 'series', 'cartoons', 'films', 'anime', 'dorama']);

const ACCOUNT_LABELS = new Set(['мої списки', 'вхід', 'login', 'sign in', 'account', 'my lists', 'personal lists']);

const SEARCH_LABELS = new Set(['пошук...', 'search', 'search box', 'search button']);

export async function collectDocInteractions(explorer: Explorer, state: WebPageState, research: string): Promise<DocStateTransition[]> {
  const sections = parseResearchSections(research);
  const transitions: DocStateTransition[] = [];
  const tabGroup = findTabGroup(sections);

  if (tabGroup) {
    transitions.push(...(await exploreTabGroup(explorer, tabGroup, state.url)));
  }

  for (const candidate of findActionCandidates(sections)) {
    if (transitions.length >= MAX_INTERACTIONS - 1) {
      break;
    }

    const transition = await executeInteraction(explorer, candidate, state.url, DEFAULT_WAIT_MS);
    if (!transition) {
      continue;
    }

    transitions.push(transition);
  }

  const paginationCandidate = findPaginationCandidate(sections);
  if (paginationCandidate && transitions.length < MAX_INTERACTIONS) {
    const transition = await executeInteraction(explorer, paginationCandidate, state.url, DEFAULT_WAIT_MS);
    if (transition) {
      transitions.push(transition);
    }
  }

  return transitions;
}

export function pickDocActionCandidates(research: string): Array<{ label: string; kind: InteractionCandidate['kind']; section: string }> {
  return findActionCandidates(parseResearchSections(research)).map((candidate) => ({
    label: candidate.element.name.trim(),
    kind: candidate.kind,
    section: candidate.sectionName,
  }));
}

async function exploreTabGroup(explorer: Explorer, tabGroup: { elements: ResearchElement[]; container?: string }, restoreUrl: string): Promise<DocStateTransition[]> {
  const transitions: DocStateTransition[] = [];

  for (const element of tabGroup.elements) {
    const transition = await executeInteraction(
      explorer,
      {
        element,
        container: tabGroup.container,
        kind: 'tab',
        sectionName: 'tab',
      },
      restoreUrl,
      TAB_WAIT_MS
    );
    if (!transition) {
      continue;
    }

    transitions.push(transition);
  }

  await restoreInteractionState(explorer, restoreUrl, buildPrimaryCommand(tabGroup.elements[0], tabGroup.container));
  return transitions;
}

async function executeInteraction(explorer: Explorer, candidate: InteractionCandidate, restoreUrl: string, waitMs: number): Promise<DocStateTransition | null> {
  const beforeState = explorer.getStateManager().getCurrentState();
  if (!beforeState) {
    return null;
  }

  const executed = await attemptInteraction(explorer, candidate);
  if (!executed) {
    return null;
  }

  await wait(waitMs);

  const afterState = explorer.getStateManager().getCurrentState();
  if (!afterState) {
    return null;
  }

  const urlChanged = beforeState.url !== afterState.url;
  const newElements = countAriaChanges(beforeState.ariaSnapshot || '', afterState.ariaSnapshot || '').newCount;
  const transition = buildTransition(candidate, beforeState, afterState, urlChanged, newElements);

  if (urlChanged) {
    await restoreInteractionState(explorer, restoreUrl);
  }

  return transition;
}

async function attemptInteraction(explorer: Explorer, candidate: InteractionCandidate): Promise<boolean> {
  const action = explorer.createAction();

  for (const command of buildClickCommands(candidate.element, candidate.container)) {
    const success = await action.attempt(command, buildPurpose(candidate), false);
    if (success) {
      return true;
    }
  }

  return false;
}

async function restoreInteractionState(explorer: Explorer, restoreUrl: string, primaryCommand?: string | null): Promise<void> {
  if (primaryCommand) {
    const action = explorer.createAction();
    const restored = await action.attempt(primaryCommand, `Restore initial state on ${restoreUrl}`, false);
    if (restored) {
      await wait(TAB_WAIT_MS);
      return;
    }
  }

  const action = explorer.createAction();
  await action.attempt(`I.amOnPage(${JSON.stringify(restoreUrl)})`, `Restore page ${restoreUrl}`, false);
}

function buildTransition(candidate: InteractionCandidate, beforeState: WebPageState, afterState: WebPageState, urlChanged: boolean, newElements: number): DocStateTransition {
  const transition: DocStateTransition = {
    action: describeAction(candidate, urlChanged),
    before: summarizeAria(beforeState.ariaSnapshot || ''),
    after: summarizeInteractiveState(candidate.kind === 'tab' ? 'Tab content' : 'After', afterState),
    discoveredUrls: collectLinks(afterState).map((link) => link.url),
    newCapabilities: collectCapabilities(afterState, urlChanged, newElements),
  };

  if (urlChanged) {
    transition.targetUrl = afterState.url;
  }

  return transition;
}

function collectCapabilities(state: WebPageState, urlChanged: boolean, newElements: number): string[] {
  const capabilities = collectDiscoveryNotes(state);
  if (urlChanged) {
    return prependUnique('Navigated to new page', capabilities);
  }
  if (newElements > 0) {
    return prependUnique(`Discovered ${newElements} new elements`, capabilities);
  }

  return capabilities;
}

function findTabGroup(sections: ReturnType<typeof parseResearchSections>): { elements: ResearchElement[]; container?: string } | null {
  for (const section of sections) {
    const sectionName = section.name.toLowerCase();
    const container = section.containerCss?.toLowerCase() || '';
    if (/(overlay|modal|popup|dialog)/i.test(sectionName) || /(overlay|modal|popup|dialog)/i.test(container)) {
      continue;
    }

    const elements = section.elements.filter((element) => isTabCandidate(element));
    if (elements.length < 2 || elements.length > 6) {
      continue;
    }

    if (section.containerCss) {
      return { elements, container: section.containerCss };
    }

    return { elements };
  }

  return null;
}

function findActionCandidates(sections: ReturnType<typeof parseResearchSections>): InteractionCandidate[] {
  const candidates: InteractionCandidate[] = [];
  const seen = new Set<string>();
  const blockedLabels = collectNavigationLabels(sections);

  for (const section of sections) {
    const sectionName = section.name.toLowerCase();
    if (isNavigationSection(sectionName)) {
      continue;
    }
    if (isShellLikeListSection(section, blockedLabels)) {
      continue;
    }

    for (const element of section.elements) {
      const candidate = toInteractionCandidate(element, sectionName, section.containerCss, blockedLabels);
      if (!candidate) {
        continue;
      }

      const key = `${candidate.kind}:${normalizeCandidateLabel(candidate.element.name)}`;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      candidates.push(candidate);
    }
  }

  return candidates.sort((a, b) => scoreCandidate(b) - scoreCandidate(a)).slice(0, MAX_PRIMARY_CANDIDATES);
}

function toInteractionCandidate(element: ResearchElement, sectionName: string, container: string | null | undefined, blockedLabels: Set<string>): InteractionCandidate | null {
  const role = getElementRole(element);
  if (!role || role === 'textbox') {
    return null;
  }
  if (isShellLocator(element.css) || isShellLocator(element.xpath) || isShellLocator(container)) {
    return null;
  }

  if (role === 'link') {
    if (!isSafeContentLink(element)) {
      return null;
    }

    const kind = getLinkKind(element, sectionName);
    if (kind !== 'detail') {
      return null;
    }
    if (blockedLabels.has(normalizeCandidateLabel(element.name))) {
      return null;
    }

    if (container) {
      return { element, container, kind, sectionName };
    }

    return { element, kind, sectionName };
  }

  if (role !== 'button' || !isInterestingButton(element.name)) {
    return null;
  }

  if (container) {
    return { element, container, kind: 'button', sectionName };
  }

  return { element, kind: 'button', sectionName };
}

function findPaginationCandidate(sections: ReturnType<typeof parseResearchSections>): InteractionCandidate | null {
  for (const section of sections) {
    if (!section.name.toLowerCase().includes('navigation')) {
      continue;
    }

    const pages = section.elements.filter((element) => getElementRole(element) === 'link' && /^\d+$/.test(element.name.trim()));
    if (pages.length < 2) {
      continue;
    }

    const target = pages.find((element) => element.name.trim() !== '7') || pages[0];
    if (section.containerCss) {
      return {
        element: target,
        container: section.containerCss,
        kind: 'pagination',
        sectionName: section.name.toLowerCase(),
      };
    }

    return {
      element: target,
      kind: 'pagination',
      sectionName: section.name.toLowerCase(),
    };
  }

  return null;
}

function buildClickCommands(element: ResearchElement, container?: string): string[] {
  const commands: string[] = [];

  if (element.css) {
    if (container && !element.css.startsWith(container)) {
      commands.push(`I.click(${JSON.stringify(element.css)}, ${JSON.stringify(container)})`);
    }
    commands.push(`I.click(${JSON.stringify(element.css)})`);
  }

  if (element.aria) {
    if (container) {
      commands.push(`I.click(${JSON.stringify(element.aria)}, ${JSON.stringify(container)})`);
    }
    commands.push(`I.click(${JSON.stringify(element.aria)})`);
  }

  const xpath = buildXPathLocator(element);
  if (xpath) {
    commands.push(`I.click(${JSON.stringify(xpath)})`);
  }

  return [...new Set(commands)];
}

function buildPrimaryCommand(element: ResearchElement, container?: string): string | null {
  return buildClickCommands(element, container)[0] || null;
}

function buildXPathLocator(element: ResearchElement): string | null {
  if (!element.name) {
    return null;
  }

  const text = xpathStringLiteral(element.name.trim());
  const role = getElementRole(element);
  if (role === 'link') {
    return `//a[normalize-space()=${text}]`;
  }
  if (role === 'button' || role === 'tab') {
    return `//*[self::button or @role="button" or @role="tab"][normalize-space()=${text}]`;
  }

  return `//*[normalize-space()=${text}]`;
}

function buildPurpose(candidate: InteractionCandidate): string {
  const label = candidate.element.name.trim();

  if (candidate.kind === 'detail') {
    return `Open content detail page for ${label}`;
  }
  if (candidate.kind === 'category') {
    return `Open category page for ${label}`;
  }
  if (candidate.kind === 'account') {
    return `Open account page for ${label}`;
  }
  if (candidate.kind === 'pagination') {
    return `Open pagination page ${label}`;
  }
  if (candidate.kind === 'button') {
    return `Check button behavior for ${label}`;
  }
  if (candidate.kind === 'tab') {
    return `Explore tab ${label}`;
  }

  return `Inspect interaction for ${label}`;
}

function summarizeAria(aria: string): string {
  const lines = aria.split('\n').filter((line) => line.trim());
  if (lines.length === 0) {
    return 'No elements';
  }

  const roleCounts: Record<string, number> = {};
  for (const role of lines.map(extractAriaRole).filter((role): role is string => Boolean(role))) {
    roleCounts[role] = (roleCounts[role] || 0) + 1;
  }

  const topRoles = Object.entries(roleCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([role, count]) => `${role}:${count}`)
    .join(', ');

  return `${lines.length} elements (${topRoles})`;
}

function extractAriaRole(line: string): string | null {
  const roleMatch = line.match(/\[role: ([\w-]+)\]/);
  if (roleMatch) {
    return roleMatch[1];
  }

  const yamlMatch = line.trim().match(/^- ([\w-]+)(?:\s|$|:)/);
  if (yamlMatch) {
    return yamlMatch[1];
  }

  return null;
}

function countAriaChanges(before: string, after: string): { newCount: number; removedCount: number } {
  const beforeLines = new Set(before.split('\n').filter((line) => line.trim()));
  const afterLines = new Set(after.split('\n').filter((line) => line.trim()));
  let newCount = 0;
  let removedCount = 0;

  for (const line of afterLines) {
    if (!beforeLines.has(line)) {
      newCount++;
    }
  }

  for (const line of beforeLines) {
    if (!afterLines.has(line)) {
      removedCount++;
    }
  }

  return { newCount, removedCount };
}

function summarizeInteractiveState(prefix: string, state: WebPageState): string {
  const parts = [summarizeAria(state.ariaSnapshot || '')];
  const headings = collectHeadings(state).slice(0, 3);
  const links = collectLinks(state).slice(0, 3);

  if (state.url) {
    parts.push(`URL ${state.url}`);
  }
  if (headings.length > 0) {
    parts.push(`Headings: ${headings.join(' | ')}`);
  }
  if (links.length > 0) {
    parts.push(`Links: ${links.map((link) => `${link.title} -> ${link.url}`).join('; ')}`);
  }

  return `${prefix}: ${parts.join('. ')}`;
}

function collectDiscoveryNotes(state: WebPageState): string[] {
  const notes: string[] = [];
  const headings = collectHeadings(state);
  const links = collectLinks(state);

  if (headings.length > 0) {
    notes.push(`Revealed headings: ${headings.slice(0, 3).join(' | ')}`);
  }
  if (links.length > 0) {
    notes.push(`Revealed ${Math.min(links.length, MAX_LINKS)} links`);
  }

  return notes;
}

function collectHeadings(state: { h1?: string; h2?: string; h3?: string; h4?: string }): string[] {
  return [state.h1, state.h2, state.h3, state.h4].filter((heading): heading is string => Boolean(heading)).map((heading) => heading.trim());
}

function collectLinks(state: { links?: Array<{ title: string; url: string }> }): Array<{ title: string; url: string }> {
  return (state.links || [])
    .filter((link) => link.url)
    .slice(0, MAX_LINKS)
    .map((link) => ({
      title: link.title || link.url,
      url: link.url,
    }));
}

function prependUnique(first: string, rest: string[]): string[] {
  const result = [first];
  for (const item of rest) {
    if (result.includes(item)) {
      continue;
    }
    result.push(item);
  }

  return result;
}

function describeAction(candidate: InteractionCandidate, urlChanged: boolean): string {
  const role = getElementRole(candidate.element);
  const label = candidate.element.name.trim();

  if (/^\d+$/.test(label)) {
    return `Opened pagination page: ${label}`;
  }
  if (candidate.kind === 'account' && urlChanged) {
    return `Opened account page: ${label}`;
  }
  if (candidate.kind === 'category' && urlChanged) {
    return `Opened category page: ${label}`;
  }
  if (role === 'button') {
    return `Activated button: ${label}`;
  }
  if (role === 'tab' || candidate.kind === 'tab') {
    return `Switched to tab: ${label}`;
  }
  if (role === 'link' && urlChanged) {
    return `Opened detail page: ${label}`;
  }

  return `Interacted with: ${label}`;
}

function isTabCandidate(element: ResearchElement): boolean {
  const role = getElementRole(element);
  if (role === 'tab') {
    return true;
  }
  if (role !== 'button') {
    return false;
  }
  if (!element.name || element.name.length > 24) {
    return false;
  }
  if (/(subscribe|yes|no|close|дякую|thanks)/i.test(element.name)) {
    return false;
  }

  return true;
}

function isSafeContentLink(element: ResearchElement): boolean {
  const name = element.name.trim();
  if (!name || /^\d+$/.test(name) || name.length < 3) {
    return false;
  }

  const lower = normalizeCandidateLabel(name);
  if (['uaserials', 'login', 'home'].includes(lower)) {
    return false;
  }

  return true;
}

function isInterestingButton(name: string): boolean {
  const lower = normalizeCandidateLabel(name);
  if (!lower) {
    return false;
  }

  return /(save|launch|submit|create|run|search|filter|sort|show|open|далі|зберегти|створити|запустити|пошук|сортувати)/i.test(lower);
}

function isNavigationSection(sectionName: string): boolean {
  return /(navigation|menu|header|footer|breadcrumb)/i.test(sectionName);
}

function isContentSection(sectionName: string): boolean {
  return /(content|list|grid|cards|results|items|catalog)/i.test(sectionName);
}

function isPrimaryContentSection(sectionName: string): boolean {
  return /(content|list|cards|results|grid|catalog|items)/i.test(sectionName);
}

function isLikelyGlobalCategory(name: string): boolean {
  return CATEGORY_LABELS.has(normalizeCandidateLabel(name));
}

function getLinkKind(element: ResearchElement, sectionName: string): InteractionCandidate['kind'] {
  if (isAccountLikeLink(element)) {
    return 'account';
  }
  if (isCategoryLikeLink(element)) {
    return 'category';
  }
  if (isLikelyDetailLink(element, sectionName)) {
    return 'detail';
  }

  return 'category';
}

function isLikelyDetailLink(element: ResearchElement, sectionName: string): boolean {
  const css = element.css?.toLowerCase() || '';
  const name = element.name.trim();

  if (!name || isLikelyGlobalCategory(name)) {
    return false;
  }
  if (isUtilityOrCategoryLocator(element.css) || isUtilityOrCategoryLocator(element.xpath)) {
    return false;
  }
  if (/(login|sign in|register|feedback|search|home)/i.test(name)) {
    return false;
  }
  if (/(card|poster|movie|film|title|item)/i.test(css)) {
    return true;
  }
  if (hasDetailPathSignal(element.css) || hasDetailPathSignal(element.xpath)) {
    return true;
  }
  if (isPrimaryContentSection(sectionName) && /^a:has-text\(/i.test(element.css || '') && name.length >= 8) {
    return true;
  }
  if (isPrimaryContentSection(sectionName) && name.length >= 8 && /[:,'"’`-]/.test(name)) {
    return true;
  }
  if (isPrimaryContentSection(sectionName) && name.length >= 14 && /\s+\S+\s+\S+/.test(name)) {
    return true;
  }

  return false;
}

function scoreCandidate(candidate: InteractionCandidate): number {
  let score = 0;

  if (candidate.kind === 'detail') {
    score += 100;
  }
  if (candidate.kind === 'account') {
    score -= 20;
  }
  if (candidate.kind === 'button') {
    score += 60;
  }
  if (candidate.kind === 'category') {
    score += 10;
  }
  if (isContentSection(candidate.sectionName)) {
    score += 40;
  }
  if (candidate.container && /(content|list|grid|cards|results|items|catalog)/i.test(candidate.container)) {
    score += 20;
  }
  if (candidate.element.css && /(card|poster|movie|film|title|item)/i.test(candidate.element.css)) {
    score += 20;
  }
  if (candidate.element.name.trim().length > 12) {
    score += 10;
  }

  return score;
}

function isUtilityOrCategoryLocator(locator: string | null): boolean {
  if (!locator) {
    return false;
  }

  return /\/(series|cartoons|films|fcartoon|collections?|anime|dorama|mylist|mylists|login|register|feedback|abuse|search|tags?|persons?|actors?)(?:\/?$|[?#"'`)]|$)/i.test(locator);
}

function hasDetailPathSignal(locator: string | null): boolean {
  if (!locator) {
    return false;
  }

  return /\/(film|films|movie|movies|serial|serials)\/.+/i.test(locator);
}

function isShellLocator(locator: string | null | undefined): boolean {
  if (!locator) {
    return false;
  }

  return /(nav\[role="navigation"\]|header|menu|breadcrumb|footer)/i.test(locator);
}

function isCategoryLikeLink(element: ResearchElement): boolean {
  const label = normalizeCandidateLabel(element.name);
  if (CATEGORY_LABELS.has(label)) {
    return true;
  }

  return isUtilityOrCategoryLocator(element.css) || isUtilityOrCategoryLocator(element.xpath);
}

function isAccountLikeLink(element: ResearchElement): boolean {
  return ACCOUNT_LABELS.has(normalizeCandidateLabel(element.name));
}

function collectNavigationLabels(sections: ReturnType<typeof parseResearchSections>): Set<string> {
  const labels = new Set<string>();

  for (const section of sections) {
    if (!isNavigationSection(section.name.toLowerCase())) {
      continue;
    }

    for (const element of section.elements) {
      const label = normalizeCandidateLabel(element.name);
      if (!label) {
        continue;
      }
      labels.add(label);
    }
  }

  return labels;
}

function isShellLikeListSection(section: ReturnType<typeof parseResearchSections>[number], blockedLabels: Set<string>): boolean {
  if (!/^list$/i.test(section.name.trim())) {
    return false;
  }
  if (section.elements.length === 0) {
    return false;
  }

  let shellSignals = 0;
  for (const element of section.elements) {
    const label = normalizeCandidateLabel(element.name);
    if (!label) {
      continue;
    }
    if (blockedLabels.has(label)) {
      shellSignals++;
      continue;
    }
    if (CATEGORY_LABELS.has(label) || ACCOUNT_LABELS.has(label) || SEARCH_LABELS.has(label)) {
      shellSignals++;
      continue;
    }
    const role = getElementRole(element);
    if (role === 'textbox' || role === 'button') {
      shellSignals++;
    }
  }

  return shellSignals >= Math.max(3, Math.ceil(section.elements.length * 0.6));
}

function normalizeCandidateLabel(label: string): string {
  return label.trim().toLowerCase();
}

function getElementRole(element: ResearchElement): string {
  return (element.aria?.role || element.type || '').toLowerCase();
}

function xpathStringLiteral(value: string): string {
  if (!value.includes("'")) {
    return `'${value}'`;
  }
  if (!value.includes('"')) {
    return `"${value}"`;
  }

  const parts = value.split("'").map((part) => `'${part}'`);
  return `concat(${parts.join(`, "'", `)})`;
}

async function wait(timeout: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, timeout));
}
