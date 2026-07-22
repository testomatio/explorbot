import { type ResearchElement, parseResearchSections } from '../../../../src/ai/researcher/parser.ts';
import type Explorer from '../../../../src/explorer.ts';
import type { StateManager, WebPageState } from '../../../../src/state-manager.ts';
import { detectFocusArea } from '../../../../src/utils/aria.ts';
import type { DocbotConfig } from '../config.ts';

export interface DocStateTransition {
  action: string;
  before: string;
  after: string;
  targetUrl?: string;
  discoveredUrls?: string[];
  newCapabilities?: string[];
  element?: InteractionElement;
  changes?: InteractionChanges;
  targetState?: InteractionState;
  screenshot?: InteractionScreenshot;
}

interface InteractionCandidate {
  element: ResearchElement;
  container?: string;
  role: 'link' | 'button' | 'tab';
  sectionName: string;
}

interface InteractionElement {
  role: string;
  name: string;
  section: string;
  container?: string;
  locator?: string;
}

interface InteractionChanges {
  urlChanged: boolean;
  newElements: number;
  removedElements: number;
}

export interface InteractionState {
  kind: 'page' | 'dialog' | 'modal' | 'section';
  label: string;
  url: string;
}

export interface InteractionScreenshot {
  title: string;
  relativePath: string;
}

export type CaptureInteractionState = (state: WebPageState, transition: DocStateTransition) => Promise<InteractionScreenshot | null>;

const DEFAULT_MAX_PRIMARY_CANDIDATES = 3;
const DEFAULT_MAX_INTERACTIONS = 5;
const MAX_LINKS = 15;
const DEFAULT_WAIT_MS = 700;
const TAB_WAIT_MS = 500;
const DEFAULT_DENIED_ACTION_LABELS = ['delete', 'remove', 'destroy', 'archive', 'discard', 'logout', 'sign out', 'signout', 'sign_out', 'erase', 'drop'];

export async function collectDocInteractions(explorer: Explorer, stateManager: StateManager, state: WebPageState, research: string, config: DocbotConfig = {}, captureState?: CaptureInteractionState): Promise<DocStateTransition[]> {
  const sections = parseResearchSections(research);
  const transitions: DocStateTransition[] = [];
  const maxInteractions = getPositiveConfigNumber(config.docs?.maxInteractions, DEFAULT_MAX_INTERACTIONS);
  const tabGroup = findTabGroup(sections);

  if (tabGroup) {
    transitions.push(...(await exploreTabGroup(explorer, stateManager, tabGroup, state.url, maxInteractions, captureState)));
  }

  for (const candidate of findActionCandidates(sections, config)) {
    if (transitions.length >= maxInteractions) {
      break;
    }

    const transition = await executeInteraction(explorer, stateManager, candidate, state.url, DEFAULT_WAIT_MS, captureState);
    if (!transition) {
      continue;
    }

    transitions.push(transition);
  }

  return transitions;
}

export function pickDocActionCandidates(research: string, config: DocbotConfig = {}): Array<{ label: string; role: InteractionCandidate['role']; section: string }> {
  return findActionCandidates(parseResearchSections(research), config).map((candidate) => ({
    label: candidate.element.name.trim(),
    role: candidate.role,
    section: candidate.sectionName,
  }));
}

async function exploreTabGroup(explorer: Explorer, stateManager: StateManager, tabGroup: { elements: ResearchElement[]; container?: string; sectionName: string }, restoreUrl: string, maxInteractions: number, captureState?: CaptureInteractionState): Promise<DocStateTransition[]> {
  const transitions: DocStateTransition[] = [];

  for (const element of tabGroup.elements) {
    if (transitions.length >= maxInteractions) {
      break;
    }

    const transition = await executeInteraction(
      explorer,
      stateManager,
      {
        element,
        container: tabGroup.container,
        role: 'tab',
        sectionName: tabGroup.sectionName,
      },
      restoreUrl,
      TAB_WAIT_MS,
      captureState
    );
    if (!transition) {
      continue;
    }

    transitions.push(transition);
  }

  await restoreInteractionState(explorer, restoreUrl, buildPrimaryCommand(tabGroup.elements[0], tabGroup.container));
  return transitions;
}

async function executeInteraction(explorer: Explorer, stateManager: StateManager, candidate: InteractionCandidate, restoreUrl: string, waitMs: number, captureState?: CaptureInteractionState): Promise<DocStateTransition | null> {
  const beforeState = stateManager.getCurrentState();
  if (!beforeState) {
    return null;
  }

  const executed = await attemptInteraction(explorer, candidate);
  if (!executed) {
    return null;
  }

  await wait(waitMs);

  const afterState = stateManager.getCurrentState();
  if (!afterState) {
    return null;
  }

  const ariaChanges = countAriaChanges(beforeState.ariaSnapshot || '', afterState.ariaSnapshot || '');
  const urlChanged = beforeState.url !== afterState.url;
  const transition = buildTransition(candidate, beforeState, afterState, {
    urlChanged,
    newElements: ariaChanges.newCount,
    removedElements: ariaChanges.removedCount,
  });

  if (captureState && isMeaningfulStateTransition(transition)) {
    const screenshot = await captureState(afterState, transition);
    if (screenshot) {
      transition.screenshot = screenshot;
    }
  }

  if (urlChanged || ariaChanges.newCount > 0) {
    await restoreInteractionState(explorer, restoreUrl);
  }

  return transition;
}

async function attemptInteraction(explorer: Explorer, candidate: InteractionCandidate): Promise<boolean> {
  const action = explorer.action();

  for (const command of buildClickCommands(candidate.element, candidate.container)) {
    const success = await action.attempt(command, buildPurpose(candidate));
    if (success) {
      return true;
    }
  }

  return false;
}

async function restoreInteractionState(explorer: Explorer, restoreUrl: string, primaryCommand?: string | null): Promise<void> {
  if (primaryCommand) {
    const action = explorer.action();
    const restored = await action.attempt(primaryCommand, `Restore initial state on ${restoreUrl}`);
    if (restored) {
      await wait(TAB_WAIT_MS);
      return;
    }
  }

  const action = explorer.action();
  await action.attempt(`I.amOnPage(${JSON.stringify(restoreUrl)})`, `Restore page ${restoreUrl}`);
}

function buildTransition(candidate: InteractionCandidate, beforeState: WebPageState, afterState: WebPageState, changes: InteractionChanges): DocStateTransition {
  const transition: DocStateTransition = {
    action: describeAction(candidate),
    before: summarizeInteractiveState(beforeState),
    after: summarizeInteractiveState(afterState),
    discoveredUrls: collectLinks(afterState).map((link) => link.url),
    newCapabilities: collectDiscoveryNotes(afterState, changes),
    element: buildInteractionElement(candidate),
    changes,
    targetState: describeTargetState(beforeState, afterState, candidate),
  };

  if (changes.urlChanged) {
    transition.targetUrl = afterState.url;
  }

  return transition;
}

function describeTargetState(beforeState: WebPageState, afterState: WebPageState, candidate: InteractionCandidate): InteractionState {
  const beforeFocus = detectFocusArea(beforeState.ariaSnapshot || null);
  const afterFocus = detectFocusArea(afterState.ariaSnapshot || null);
  if (afterFocus.detected && (!beforeFocus.detected || beforeFocus.name !== afterFocus.name)) {
    return {
      kind: afterFocus.type || 'dialog',
      label: afterFocus.name || candidate.element.name.trim(),
      url: afterState.url,
    };
  }

  const beforePath = beforeState.url.split('?')[0].split('#')[0];
  const afterPath = afterState.url.split('?')[0].split('#')[0];
  const headings = collectHeadings(afterState);
  let kind: InteractionState['kind'] = 'page';
  if (beforePath === afterPath) {
    kind = 'section';
  }
  return {
    kind,
    label: headings[0] || afterState.title || candidate.element.name.trim(),
    url: afterState.url,
  };
}

function isMeaningfulStateTransition(transition: DocStateTransition): boolean {
  if (transition.targetUrl || transition.changes?.urlChanged) {
    return true;
  }
  return (transition.changes?.newElements || 0) > 0;
}

function buildInteractionElement(candidate: InteractionCandidate): InteractionElement {
  const element: InteractionElement = {
    role: candidate.role,
    name: candidate.element.name.trim(),
    section: candidate.sectionName,
  };

  if (candidate.container) {
    element.container = candidate.container;
  }
  if (candidate.element.css || candidate.element.xpath) {
    element.locator = candidate.element.css || candidate.element.xpath || undefined;
  }

  return element;
}

function collectDiscoveryNotes(state: WebPageState, changes: InteractionChanges): string[] {
  const notes: string[] = [];
  const headings = collectHeadings(state);
  const links = collectLinks(state);

  if (changes.urlChanged) {
    notes.push('URL changed after interaction');
  }
  if (changes.newElements > 0) {
    notes.push(`ARIA snapshot gained ${changes.newElements} elements`);
  }
  if (changes.removedElements > 0) {
    notes.push(`ARIA snapshot removed ${changes.removedElements} elements`);
  }
  if (headings.length > 0) {
    notes.push(`Visible headings after interaction: ${headings.slice(0, 3).join(' | ')}`);
  }
  if (links.length > 0) {
    notes.push(`Visible links after interaction: ${Math.min(links.length, MAX_LINKS)}`);
  }

  return notes;
}

function findTabGroup(sections: ReturnType<typeof parseResearchSections>): { elements: ResearchElement[]; container?: string; sectionName: string } | null {
  for (const section of sections) {
    const sectionName = section.name.toLowerCase();
    const container = section.containerCss?.toLowerCase() || '';
    if (isOverlaySection(sectionName, container)) {
      continue;
    }

    const elements = section.elements.filter((element) => getElementRole(element) === 'tab');
    if (elements.length < 2 || elements.length > 6) {
      continue;
    }

    return {
      elements,
      container: section.containerCss || undefined,
      sectionName: section.name,
    };
  }

  return null;
}

function findActionCandidates(sections: ReturnType<typeof parseResearchSections>, config: DocbotConfig): InteractionCandidate[] {
  const candidates: InteractionCandidate[] = [];
  const seen = new Set<string>();
  const navigationLabels = collectNavigationLabels(sections);
  const maxPrimaryCandidates = getPositiveConfigNumber(config.docs?.maxPrimaryCandidates, DEFAULT_MAX_PRIMARY_CANDIDATES);

  for (const section of sections) {
    const sectionName = section.name.toLowerCase();
    const container = section.containerCss?.toLowerCase() || '';
    if (isIgnoredSection(sectionName, container)) {
      continue;
    }

    for (const element of section.elements) {
      const candidate = toInteractionCandidate(element, section.name, section.containerCss, navigationLabels, config);
      if (!candidate) {
        continue;
      }

      const key = `${candidate.role}:${normalizeCandidateLabel(candidate.element.name)}`;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      candidates.push(candidate);
    }
  }

  return candidates.sort((a, b) => scoreCandidate(b) - scoreCandidate(a)).slice(0, maxPrimaryCandidates);
}

function toInteractionCandidate(element: ResearchElement, sectionName: string, container: string | null | undefined, navigationLabels: Set<string>, config: DocbotConfig): InteractionCandidate | null {
  const role = getElementRole(element);
  if (role !== 'link' && role !== 'button' && role !== 'tab') {
    return null;
  }
  if (!hasUsableName(element)) {
    return null;
  }
  if (isPageShellContainer(element.css) || isPageShellContainer(element.xpath)) {
    return null;
  }
  if (isDestructiveAction(element, config)) {
    return null;
  }
  if (role === 'link' && navigationLabels.has(normalizeCandidateLabel(element.name))) {
    return null;
  }

  return {
    element,
    container: container || undefined,
    role,
    sectionName,
  };
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
  return `Explore ${candidate.role} ${candidate.element.name.trim()}`;
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

function summarizeInteractiveState(state: WebPageState): string {
  const parts = [summarizeAria(state.ariaSnapshot || '')];
  const headings = collectHeadings(state).slice(0, 3);
  const links = collectLinks(state).slice(0, 3);

  if (state.url) {
    parts.push(`URL ${state.url}`);
  }
  if (headings.length > 0) {
    parts.push(`Headings: ${headings.map((heading) => limitInlineText(heading, 90)).join(' | ')}`);
  }
  if (links.length > 0) {
    parts.push(`Links: ${links.map((link) => `${link.title} -> ${link.url}`).join('; ')}`);
  }

  return parts.join('. ');
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

function describeAction(candidate: InteractionCandidate): string {
  return `Clicked ${candidate.role}: ${candidate.element.name.trim()}`;
}

function hasUsableName(element: ResearchElement): boolean {
  const name = element.name.trim();
  if (!name) {
    return false;
  }
  if (name.length < 2) {
    return false;
  }
  return true;
}

function isNavigationSection(sectionName: string): boolean {
  return /(navigation|menu|header|footer|breadcrumb)/i.test(sectionName);
}

function isContentControlSection(sectionName: string): boolean {
  return /(content|control|filter|toolbar|action|list|data)/i.test(sectionName);
}

function isIgnoredSection(sectionName: string, container: string): boolean {
  if (isOverlaySection(sectionName, container)) {
    return true;
  }
  if (isContentControlSection(sectionName)) {
    return false;
  }
  return isNavigationSection(sectionName) || isPageShellContainer(container);
}

function isOverlaySection(sectionName: string, container: string): boolean {
  return /(overlay|modal|popup|dialog)/i.test(sectionName) || /(overlay|modal|popup|dialog)/i.test(container);
}

function scoreCandidate(candidate: InteractionCandidate): number {
  let score = 0;

  if (candidate.role === 'link') {
    score += 50;
  }
  if (candidate.role === 'button') {
    score += 40;
  }
  if (candidate.role === 'tab') {
    score += 30;
  }
  if (candidate.container) {
    score += 10;
  }
  if (candidate.element.css) {
    score += 5;
  }
  if (candidate.element.name.trim().length > 8) {
    score += 5;
  }

  return score;
}

function isPageShellContainer(locator: string | null | undefined): boolean {
  if (!locator) {
    return false;
  }

  return /(^|[\s>+~,.#\[])(nav|navigation|mainnav|header|menu|breadcrumb|footer)([\s>+~,.#\]_-]|$)/i.test(locator);
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

function normalizeCandidateLabel(label: string): string {
  return label.trim().toLowerCase();
}

function isDestructiveAction(element: ResearchElement, config: DocbotConfig): boolean {
  const label = normalizeCandidateLabel(element.name);
  const deniedLabels = config.docs?.deniedActionLabels || DEFAULT_DENIED_ACTION_LABELS;
  if (deniedLabels.some((denied) => label.includes(normalizeCandidateLabel(denied)))) {
    return true;
  }

  const locator = `${element.css || ''} ${element.xpath || ''}`.toLowerCase();
  return deniedLabels.some((denied) => locator.includes(normalizeCandidateLabel(denied)));
}

function getPositiveConfigNumber(value: number | undefined, fallback: number): number {
  if (!value || value <= 0) {
    return fallback;
  }
  return value;
}

function limitInlineText(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

function getElementRole(element: ResearchElement): 'link' | 'button' | 'tab' | string {
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
