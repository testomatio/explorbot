import chalk from 'chalk';
import type { ExperienceTocEntry, ExperienceTracker } from '../experience-tracker.js';
import { tag } from '../utils/logger.js';
import { BaseCommand, type Suggestion } from './base-command.js';

export class ExperienceCommand extends BaseCommand {
  name = 'experience';
  description = 'List stored experiences; filter by filename or URL substring; expand a section by ref (e.g. LW1)';
  options = [
    { flags: '--recent', description: 'Only files modified within the last 30 days' },
    { flags: '--old', description: 'Only files modified more than 30 days ago' },
  ];
  suggestions: Suggestion[] = [];

  async execute(args: string): Promise<void> {
    const { opts, args: remaining } = this.parseArgs(args);
    if (opts.recent && opts.old) {
      tag('info').log('Flags --recent and --old are mutually exclusive.');
      return;
    }
    const recency = opts.recent ? 'recent' : opts.old ? 'old' : undefined;

    const tracker = this.explorBot.getExperienceTracker();
    const [first, second] = remaining;

    const combinedRef = first?.match(/^([A-Z]+)[.\-]?(\d+)$/i);
    if (combinedRef) {
      this.expand(tracker, combinedRef[1].toUpperCase(), Number(combinedRef[2]));
      return;
    }

    if (first && /^[A-Z]+$/i.test(first) && second && /^\d+$/.test(second)) {
      this.expand(tracker, first.toUpperCase(), Number(second));
      return;
    }

    const secondRef = second?.match(/^([A-Z]+)[.\-]?(\d+)$/i);
    if (first && secondRef) {
      this.expand(tracker, secondRef[1].toUpperCase(), Number(secondRef[2]), first);
      return;
    }

    if (first && second && /^\d+$/.test(second)) {
      const toc = tracker.listAllExperienceToc(first, { recency });
      if (toc.length === 0) {
        tag('info').log(`No experience found matching: ${first}`);
        return;
      }
      this.expand(tracker, toc[0].fileTag, Number(second), first);
      return;
    }

    const toc = tracker.listAllExperienceToc(first, { recency });
    if (toc.length === 0) {
      const scope = recency === 'recent' ? ' (recent only)' : recency === 'old' ? ' (old only)' : '';
      tag('info').log(first ? `No experience found matching: ${first}${scope}` : `No experience files found${scope}. Experience is recorded automatically during test sessions.`);
      return;
    }

    tag('info').log(this.formatToc(toc, first, recency));

    const hints: Suggestion[] = [];
    const exampleRef = `${toc[0].fileTag}1`;
    hints.push({ command: `experience ${exampleRef}`, hint: 'read a section' });

    const overloaded = toc.filter((entry) => entry.sections.length >= 10);
    for (const entry of overloaded) {
      hints.push({ command: `compact ${entry.fileHash}.md`, hint: `compact this file (${entry.sections.length} sections)` });
    }

    this.suggestions = hints;
  }

  private expand(tracker: ExperienceTracker, fileTag: string, sectionIndex: number, urlFilter?: string): void {
    const section = tracker.getExperienceSectionByTag(fileTag, sectionIndex, urlFilter);
    if (!section) {
      tag('info').log(`No section ${fileTag}${sectionIndex} found${urlFilter ? ` for URL matching: ${urlFilter}` : ''}`);
      return;
    }

    tag('info').log(`${chalk.dim('File:')} ${chalk.bold.green(`${section.fileHash}.md`)}`);
    tag('info').log(`${chalk.dim('URL:')}  ${chalk.bold.cyan(section.url)}`);
    tag('info').log(`${chalk.green(`${fileTag}${sectionIndex}`)} ${chalk.bold(section.title)}`);
    tag('multiline').log(this.stripLeadingHeading(section.content.trim()));
  }

  private formatToc(toc: ExperienceTocEntry[], urlFilter?: string, recency?: 'recent' | 'old'): string {
    const totalSections = toc.reduce((sum, entry) => sum + entry.sections.length, 0);
    const lines: string[] = [];

    const scope = recency === 'recent' ? ' (recent, ≤30d)' : recency === 'old' ? ' (old, >30d)' : '';
    const title = urlFilter ? `Experience matching "${urlFilter}"${scope}` : `Stored experience${scope}`;
    lines.push(chalk.bold.underline.cyan(title));

    for (const entry of toc) {
      lines.push('');
      lines.push(chalk.bold.green(`${entry.fileHash}.md`));
      lines.push(`    ${chalk.cyan(entry.url)}`);
      for (let i = 0; i < entry.sections.length; i++) {
        const section = entry.sections[i];
        const isLast = i === entry.sections.length - 1;
        const branch = isLast ? '└─' : '├─';
        const ref = chalk.yellow(`${entry.fileTag}${section.index}`);
        lines.push(`    ${chalk.dim(branch)} ${ref} ${chalk.dim(':')} ${section.title}`);
      }
    }

    const urls = new Set(toc.map((e) => e.url)).size;
    lines.push('');
    lines.push(chalk.bold('Summary'));
    lines.push(`  ${chalk.dim('URLs:')}     ${chalk.bold(String(urls))}`);
    lines.push(`  ${chalk.dim('Files:')}    ${chalk.bold(String(toc.length))}`);
    lines.push(`  ${chalk.dim('Entries:')}  ${chalk.bold(String(totalSections))}`);

    return lines.join('\n');
  }

  private stripLeadingHeading(body: string): string {
    const lines = body.split('\n');
    if (lines[0]?.match(/^#{1,6}\s/)) {
      return lines.slice(1).join('\n').trimStart();
    }
    return body;
  }
}
