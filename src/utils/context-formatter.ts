import { basename } from 'node:path';
import chalk from 'chalk';
import { summarizeInteractiveNodes } from './aria.js';

export interface ContextData {
  url: string;
  title?: string;
  headings: {
    h1?: string;
    h2?: string;
    h3?: string;
    h4?: string;
  };
  experience: Array<{ filePath: string; data: any; content: string }>;
  knowledge: Array<{ filePath: string; url: string; content: string }>;
  ariaSnapshot: string | null;
  combinedHtml?: string;
  research?: string;
}

function section(title: string): string {
  return chalk.bold.white(title.toUpperCase());
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => chalk.gray(`    ${line}`))
    .join('\n');
}

export type ContextMode = 'attached' | 'compact' | 'full';

export function formatContextSummary(data: ContextData, mode: ContextMode = 'compact'): string {
  if (mode === 'full') {
    return formatContextFull(data);
  }
  if (mode === 'attached') {
    return formatContextAttached(data);
  }
  return formatContextCompact(data);
}

function formatContextAttached(data: ContextData): string {
  const lines: string[] = [];

  lines.push(section('PAGE') + chalk.gray(' (Auto-attached)'));
  lines.push(indent(data.url));
  if (data.title) {
    lines.push(indent(data.title));
  }
  lines.push('');

  const headingLines: string[] = [];
  if (data.headings.h1) headingLines.push(`H1: ${data.headings.h1}`);
  if (data.headings.h2) headingLines.push(`H2: ${data.headings.h2}`);
  if (data.headings.h3) headingLines.push(`H3: ${data.headings.h3}`);
  if (data.headings.h4) headingLines.push(`H4: ${data.headings.h4}`);

  if (headingLines.length > 0) {
    lines.push(section('HEADINGS') + chalk.gray(' (Auto-attached)'));
    lines.push(indent(headingLines.join('\n')));
    lines.push('');
  }

  if (data.experience.length > 0) {
    lines.push(section(`EXPERIENCE (${data.experience.length} files)`) + chalk.gray(' (Auto-attached)'));
    for (const exp of data.experience) {
      lines.push(indent(`--- ${basename(exp.filePath)} ---`));
      if (exp.data?.url) {
        lines.push(indent(`URL: ${exp.data.url}`));
      }
      if (exp.content.trim()) {
        lines.push(indent(exp.content.trim()));
      }
    }
    lines.push('');
  }

  if (data.knowledge.length > 0) {
    lines.push(section(`KNOWLEDGE (${data.knowledge.length} files)`) + chalk.gray(' (Auto-attached)'));
    for (const k of data.knowledge) {
      lines.push(indent(`--- ${basename(k.filePath)} ---`));
      lines.push(indent(`Pattern: ${k.url}`));
      if (k.content.trim()) {
        lines.push(indent(k.content.trim()));
      }
    }
    lines.push('');
  }

  lines.push(section('RESEARCH') + chalk.gray(' (Auto-attached)'));
  if (data.research) {
    lines.push(indent(data.research));
  } else {
    lines.push(indent('(Not available)'));
  }
  lines.push('');

  if (data.ariaSnapshot) {
    lines.push(section('ARIA') + chalk.gray(' (Auto-attached)'));
    lines.push(indent(data.ariaSnapshot));
    lines.push('');
  }

  return lines.join('\n');
}

function formatContextCompact(data: ContextData): string {
  const lines: string[] = [];

  lines.push(section('PAGE') + chalk.gray(' (Auto-attached)'));
  lines.push(indent(data.url));
  if (data.title) {
    lines.push(indent(data.title));
  }
  lines.push('');

  const headingLines: string[] = [];
  if (data.headings.h1) headingLines.push(`H1: ${data.headings.h1}`);
  if (data.headings.h2) headingLines.push(`H2: ${data.headings.h2}`);
  if (data.headings.h3) headingLines.push(`H3: ${data.headings.h3}`);
  if (data.headings.h4) headingLines.push(`H4: ${data.headings.h4}`);

  if (headingLines.length > 0) {
    lines.push(section('HEADINGS') + chalk.gray(' (Auto-attached)'));
    lines.push(indent(headingLines.join('\n')));
    lines.push('');
  }

  if (data.experience.length > 0) {
    lines.push(section(`EXPERIENCE (${data.experience.length} files)`) + chalk.gray(' (Auto-attached)'));
    const expFiles = data.experience.map((exp) => basename(exp.filePath)).join('\n');
    lines.push(indent(expFiles));
    lines.push('');
  }

  if (data.knowledge.length > 0) {
    lines.push(section(`KNOWLEDGE (${data.knowledge.length} files)`) + chalk.gray(' (Auto-attached)'));
    const knowFiles = data.knowledge.map((k) => `${basename(k.filePath)} → ${k.url}`).join('\n');
    lines.push(indent(knowFiles));
    lines.push('');
  }

  lines.push(section('RESEARCH') + chalk.gray(' (Auto-attached)'));
  if (data.research) {
    lines.push(indent('(cached)'));
  } else {
    lines.push(indent('(Not available)'));
  }
  lines.push('');

  const ariaSummary = summarizeInteractiveNodes(data.ariaSnapshot);
  if (ariaSummary.length > 0) {
    lines.push(section('INTERACTIVE ELEMENTS') + chalk.gray(' (Auto-attached)'));
    const display = ariaSummary.slice(0, 15);
    lines.push(indent(display.join('\n')));
    if (ariaSummary.length > 15) {
      lines.push(indent(`... and ${ariaSummary.length - 15} more`));
    }
    lines.push('');
  }

  lines.push(chalk.gray('Commands: /context:aria, /context:html, /context:knowledge, /context:experience'));

  return lines.join('\n');
}

function formatContextFull(data: ContextData): string {
  const lines: string[] = [];

  lines.push(section('PAGE') + chalk.gray(' (Auto-attached)'));
  lines.push(indent(data.url));
  if (data.title) {
    lines.push(indent(data.title));
  }
  lines.push('');

  const headingLines: string[] = [];
  if (data.headings.h1) headingLines.push(`H1: ${data.headings.h1}`);
  if (data.headings.h2) headingLines.push(`H2: ${data.headings.h2}`);
  if (data.headings.h3) headingLines.push(`H3: ${data.headings.h3}`);
  if (data.headings.h4) headingLines.push(`H4: ${data.headings.h4}`);

  if (headingLines.length > 0) {
    lines.push(section('HEADINGS') + chalk.gray(' (Auto-attached)'));
    lines.push(indent(headingLines.join('\n')));
    lines.push('');
  }

  if (data.experience.length > 0) {
    lines.push(section(`EXPERIENCE (${data.experience.length} files)`) + chalk.gray(' (Auto-attached)'));
    for (const exp of data.experience) {
      lines.push(indent(`--- ${basename(exp.filePath)} ---`));
      if (exp.data?.url) {
        lines.push(indent(`URL: ${exp.data.url}`));
      }
      if (exp.content.trim()) {
        lines.push(indent(exp.content.trim()));
      }
    }
    lines.push('');
  }

  if (data.knowledge.length > 0) {
    lines.push(section(`KNOWLEDGE (${data.knowledge.length} files)`) + chalk.gray(' (Auto-attached)'));
    for (const k of data.knowledge) {
      lines.push(indent(`--- ${basename(k.filePath)} ---`));
      lines.push(indent(`Pattern: ${k.url}`));
      if (k.content.trim()) {
        lines.push(indent(k.content.trim()));
      }
    }
    lines.push('');
  }

  lines.push(section('RESEARCH') + chalk.gray(' (Auto-attached)'));
  if (data.research) {
    lines.push(indent(data.research));
  } else {
    lines.push(indent('(Not available)'));
  }
  lines.push('');

  if (data.ariaSnapshot) {
    lines.push(section('ARIA') + chalk.gray(' (Auto-attached)'));
    lines.push(indent(data.ariaSnapshot));
    lines.push('');
  }

  if (data.combinedHtml) {
    lines.push(section('HTML'));
    lines.push(chalk.gray(data.combinedHtml));
    lines.push('');
  }

  return lines.join('\n');
}
