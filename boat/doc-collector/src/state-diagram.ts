import path from 'node:path';
import { normalizeUrl } from '../../../src/state-manager.ts';
import { normalizeInlineText } from '../../../src/utils/strings.ts';
import type { StateTransition } from './ai/documentarian.ts';

function buildStateGraph(outputDir: string, pages: DocumentedPage[]): StateGraph {
  const pageIds = new Map<string, string>();
  const pageNodes: StateNode[] = [];
  const adjacency = new Map<string, Set<string>>();
  const classAssignment = new Map<StateClass, string[]>([
    ['page', []],
    ['dialog', []],
    ['section', []],
  ]);

  for (const [index, page] of pages.entries()) {
    const id = `page${index}`;
    pageIds.set(normalizeUrl(page.url), id);
    adjacency.set(id, new Set());
    classAssignment.get('page')?.push(id);
    pageNodes.push({ id, kind: 'page', label: page.title || page.url, subLabel: page.url, filePath: page.filePath });
  }

  const stateKeys = new Map<string, string>();
  const transientByPage = new Map<string, StateNode[]>();
  const clicks: StateClick[] = [];
  const edges: StateEdge[] = [];
  const drawnBack = new Set<string>();
  let stateIndex = 0;

  for (const [pageIndex, page] of pages.entries()) {
    const sourceId = `page${pageIndex}`;
    for (const transition of page.interactions || []) {
      const targetState = transition.targetState;
      if (!targetState) {
        continue;
      }

      const normalizedTarget = normalizeUrl(targetState.url);
      const isPageTarget = targetState.kind === 'page';
      let pageTargetId: string | undefined;
      if (isPageTarget) {
        pageTargetId = pageIds.get(normalizedTarget);
      }
      let targetId: string | undefined;
      if (pageTargetId && pageTargetId !== sourceId) {
        targetId = pageTargetId;
      }

      if (!targetId) {
        const stateKey = `${sourceId}:${targetState.kind}:${normalizeInlineText(targetState.label)}:${normalizedTarget}`;
        targetId = stateKeys.get(stateKey);
        if (!targetId) {
          targetId = `state${stateIndex++}`;
          stateKeys.set(stateKey, targetId);
          adjacency.set(targetId, new Set());
          classAssignment.get(classForKind(targetState.kind))?.push(targetId);
          const list = transientByPage.get(sourceId) ?? [];
          list.push({ id: targetId, kind: targetState.kind, label: targetState.label, subLabel: targetState.kind, parentPageId: sourceId });
          transientByPage.set(sourceId, list);
          if (transition.screenshot) {
            const screenshotPath = path.resolve(path.dirname(page.filePath), transition.screenshot.relativePath);
            clicks.push({ node: targetId, target: path.relative(outputDir, screenshotPath).replaceAll('\\', '/'), tooltip: 'Open state screenshot' });
          }
        }
      }

      if (!targetId) {
        continue;
      }

      const pairKey = `${sourceId}>${targetId}`;
      if (adjacency.get(targetId)?.has(sourceId)) {
        if (drawnBack.has(pairKey)) {
          continue;
        }
        drawnBack.add(pairKey);
        edges.push({ source: sourceId, target: targetId, action: transition.action, isBack: true });
        continue;
      }

      if (adjacency.get(sourceId)?.has(targetId) || createsCycle(sourceId, targetId, adjacency)) {
        continue;
      }
      adjacency.get(sourceId)?.add(targetId);
      edges.push({ source: sourceId, target: targetId, action: transition.action, isBack: false });
    }
  }

  const pageClicks: StateClick[] = [];
  for (const pageNode of pageNodes) {
    const filePath = pageNode.filePath;
    if (!filePath) {
      continue;
    }
    const relativeFile = path.relative(outputDir, filePath).replaceAll('\\', '/');
    pageClicks.push({ node: pageNode.id, target: relativeFile, tooltip: `Open ${pageNode.label}` });
  }

  return { pages: pageNodes, transientByPage, edges, clicks: [...pageClicks, ...clicks], classAssignment };
}

function renderMermaidBody(outputDir: string, pages: DocumentedPage[]): string {
  return renderMermaidFromGraph(buildStateGraph(outputDir, pages));
}

function renderMermaidFromGraph(graph: StateGraph): string {
  const lines: string[] = ['flowchart TD'];
  if (graph.pages.length === 0) {
    lines.push('  empty["No documented states"]');
    return lines.join('\n');
  }

  for (const page of graph.pages) {
    lines.push(`  ${renderNodeLine(page)}`);
    const children = graph.transientByPage.get(page.id);
    if (!children || children.length === 0) {
      continue;
    }
    lines.push(`  subgraph sg_${page.id} ["${escapeMermaidLabel(page.label)} — transient states"]`);
    for (const child of children) {
      lines.push(`    ${renderNodeLine(child)}`);
    }
    lines.push('  end');
  }

  for (const edge of graph.edges) {
    let arrow = '-->';
    if (edge.isBack) {
      arrow = '-.->';
    }
    lines.push(`  ${edge.source} ${arrow}|"${escapeMermaidLabel(edge.action)}"| ${edge.target}`);
  }

  lines.push('  classDef page fill:#dbeafe,stroke:#2563eb,color:#0f172a;');
  lines.push('  classDef dialog fill:#ffedd5,stroke:#ea580c,color:#0f172a;');
  lines.push('  classDef section fill:#f3e8ff,stroke:#9333ea,color:#0f172a;');
  for (const [className, ids] of graph.classAssignment) {
    if (ids.length === 0) {
      continue;
    }
    lines.push(`  class ${ids.join(',')} ${className};`);
  }

  for (const click of graph.clicks) {
    lines.push(`  click ${click.node} "${click.target}" "${escapeMermaidLabel(click.tooltip)}"`);
  }

  return lines.join('\n');
}

function renderStateMapFromGraph(graph: StateGraph): string {
  if (graph.pages.length === 0) {
    return '';
  }
  const clickByNode = new Map(graph.clicks.map((click) => [click.node, click]));
  const rows = ['| State | Type | Open |', '| --- | --- | --- |'];
  for (const pageNode of graph.pages) {
    const pageClick = clickByNode.get(pageNode.id);
    let openCell = '—';
    if (pageClick) {
      openCell = `[open page](${pageClick.target})`;
    }
    rows.push(`| ${escapeTable(pageNode.label)} | page | ${openCell} |`);
    for (const child of graph.transientByPage.get(pageNode.id) ?? []) {
      const childClick = clickByNode.get(child.id);
      let childCell = '—';
      if (childClick) {
        childCell = `[view screenshot](${childClick.target})`;
      }
      rows.push(`| ${escapeTable(child.label)} | ${child.kind} | ${childCell} |`);
    }
  }
  return rows.join('\n');
}

function renderNodeLine(node: StateNode): string {
  const label = `${escapeMermaidLabel(node.label)}<br/>${escapeMermaidLabel(node.subLabel)}`;
  if (node.kind === 'dialog' || node.kind === 'modal') {
    return `${node.id}{{"${label}"}}`;
  }
  if (node.kind === 'section') {
    return `${node.id}("${label}")`;
  }
  return `${node.id}["${label}"]`;
}

function createsCycle(sourceId: string, targetId: string, adjacency: Map<string, Set<string>>): boolean {
  if (sourceId === targetId) {
    return true;
  }

  const pending = [targetId];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const nodeId = pending.pop();
    if (!nodeId || visited.has(nodeId)) {
      continue;
    }
    if (nodeId === sourceId) {
      return true;
    }
    visited.add(nodeId);
    pending.push(...(adjacency.get(nodeId) || []));
  }
  return false;
}

function escapeMermaidLabel(value: string): string {
  return normalizeInlineText(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('|', '&#124;');
}

function escapeTable(value: string): string {
  return normalizeInlineText(value).replaceAll('|', '\\|');
}

function classForKind(kind: StateKind): StateClass {
  if (kind === 'section') {
    return 'section';
  }
  if (kind === 'page') {
    return 'page';
  }
  return 'dialog';
}

interface DocumentedPage {
  url: string;
  title: string;
  summary: string;
  canCount: number;
  mightCount: number;
  interactionCount: number;
  canActions: string[];
  mightActions: string[];
  interactionActions: string[];
  qualityNotes: string[];
  interactions?: StateTransition[];
  filePath: string;
}

interface SkippedPage {
  url: string;
  reason: string;
}

type StateKind = 'page' | 'dialog' | 'modal' | 'section';
type StateClass = 'page' | 'dialog' | 'section';

interface StateNode {
  id: string;
  kind: StateKind;
  label: string;
  subLabel: string;
  filePath?: string;
  parentPageId?: string;
}

interface StateEdge {
  source: string;
  target: string;
  action: string;
  isBack: boolean;
}

interface StateClick {
  node: string;
  target: string;
  tooltip: string;
}

interface StateGraph {
  pages: StateNode[];
  transientByPage: Map<string, StateNode[]>;
  edges: StateEdge[];
  clicks: StateClick[];
  classAssignment: Map<StateClass, string[]>;
}

export { buildStateGraph, renderMermaidBody, renderMermaidFromGraph, renderStateMapFromGraph };
export type { DocumentedPage, SkippedPage, StateGraph, StateNode, StateEdge, StateClick };
