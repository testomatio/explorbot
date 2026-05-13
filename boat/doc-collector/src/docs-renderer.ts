import path from 'node:path';
import type { WebPageState } from '../../../src/state-manager.ts';
import type { PageDocumentation } from './ai/documentarian.ts';

function renderPageDocumentation(state: WebPageState, documentation: PageDocumentation): string {
  const lines: string[] = [];
  lines.push(`# ${state.url}`);
  lines.push('');

  if (state.title) {
    lines.push(`Title: ${normalizeInlineText(state.title)}`);
    lines.push('');
  }

  lines.push('## Purpose');
  lines.push('');
  lines.push(ensureSentence(documentation.summary));
  lines.push('');
  lines.push('## User Can');
  lines.push('');

  if (documentation.can.length === 0) {
    lines.push('- No proven actions were identified from the collected research.');
    lines.push('');
  }

  for (const item of documentation.can) {
    lines.push(`- ${normalizeAction(item.action)} -> ${item.scope}`);
    lines.push(`  Proof: ${ensureSentence(item.evidence)}`);
  }

  if (documentation.can.length > 0) {
    lines.push('');
  }

  lines.push('## User Might');
  lines.push('');

  if (documentation.might.length === 0) {
    lines.push('- No assumption-based actions were identified.');
    lines.push('');
  }

  for (const item of documentation.might) {
    lines.push(`- ${normalizeAction(item.action, 'might')} -> ${item.scope}`);
    lines.push(`  Signal: ${ensureSentence(item.evidence)}`);
  }

  if (documentation.might.length > 0) {
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

function renderSpecIndex(outputDir: string, startPath: string, pages: DocumentedPage[], skipped: SkippedPage[], maxPages: number): string {
  const lines: string[] = [];
  lines.push('# Website Spec');
  lines.push('');
  lines.push('## Overview');
  lines.push('');
  lines.push(`Start page: ${startPath}`);
  lines.push(`Pages documented: ${pages.length}`);
  lines.push(`Pages skipped: ${skipped.length}`);
  lines.push(`Max pages: ${maxPages}`);
  lines.push('');
  lines.push('## Pages');
  lines.push('');

  if (pages.length === 0) {
    lines.push('- No pages were documented.');
    lines.push('');
  }

  for (const page of pages) {
    const relativeFile = path.relative(outputDir, page.filePath).replaceAll('\\', '/');
    lines.push(`### [${page.url}](${relativeFile})`);
    lines.push('');
    lines.push(`Purpose: ${ensureSentence(page.summary)}`);
    lines.push(`Proven actions: ${page.canCount}`);
    lines.push(`Possible actions: ${page.mightCount}`);
    if (page.title) {
      lines.push(`Title: ${normalizeInlineText(page.title)}`);
    }
    lines.push('');

    if (page.canActions.length > 0) {
      lines.push('User Can:');
      for (const action of page.canActions) {
        lines.push(`- ${normalizeAction(action, 'can')}`);
      }
      lines.push('');
    }

    if (page.mightActions.length > 0) {
      lines.push('User Might:');
      for (const action of page.mightActions) {
        lines.push(`- ${normalizeAction(action, 'might')}`);
      }
      lines.push('');
    }
  }

  if (skipped.length > 0) {
    lines.push('## Skipped');
    lines.push('');

    for (const page of skipped) {
      lines.push(`- ${page.url}. Reason: ${ensureSentence(page.reason)}`);
    }

    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

function normalizeAction(action: string, kind: 'can' | 'might' = 'can'): string {
  const trimmed = normalizeInlineText(action);
  if (!trimmed) {
    return 'user can interact with this page';
  }

  const normalized = ensureSentence(trimmed).slice(0, -1);
  const lower = normalized.toLowerCase();

  if (kind === 'can') {
    if (lower.startsWith('user can ')) {
      return normalized;
    }
    if (lower.startsWith('can ')) {
      return `user can ${normalized.slice(4)}`;
    }
    if (lower.startsWith('user might ')) {
      return `user can ${normalized.slice(11)}`;
    }
    return `user can ${normalized}`;
  }

  if (lower.startsWith('user might ')) {
    return normalized;
  }
  if (lower.startsWith('might ')) {
    return `user might ${normalized.slice(6)}`;
  }
  if (lower.startsWith('user can ')) {
    return `user might ${normalized.slice(9)}`;
  }
  if (lower.startsWith('can ')) {
    return `user might ${normalized.slice(4)}`;
  }
  return `user might ${normalized}`;
}

function ensureSentence(text: string): string {
  const trimmed = normalizeInlineText(text);
  if (!trimmed) {
    return '';
  }
  if (/[.!?]$/.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}.`;
}

function normalizeInlineText(text: string): string {
  return text.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

interface DocumentedPage {
  url: string;
  title: string;
  summary: string;
  canCount: number;
  mightCount: number;
  canActions: string[];
  mightActions: string[];
  filePath: string;
}

interface SkippedPage {
  url: string;
  reason: string;
}

export { renderPageDocumentation, renderSpecIndex, ensureSentence, normalizeAction };
export type { DocumentedPage, SkippedPage };
