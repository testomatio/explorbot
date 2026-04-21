import { basename } from 'node:path';
import chalk from 'chalk';
import type { ExperienceFile } from '../ai/experience-compactor.js';
import type { ExperienceTracker } from '../experience-tracker.js';
import { tag } from '../utils/logger.js';
import { BaseCommand, type Suggestion } from './base-command.js';

const COMPACT_THRESHOLD = 5000;

export class CompactCommand extends BaseCommand {
  name = 'compact';
  description = 'Compact stored experience files; optionally filtered by filename or URL substring';
  options = [
    { flags: '--dry-run', description: 'Preview without running AI or writing files' },
    { flags: '--no-merge', description: 'Skip the cross-URL merge step when compacting all' },
  ];
  suggestions: Suggestion[] = [];

  async execute(args: string): Promise<void> {
    const { opts, args: remaining } = this.parseArgs(args);
    const target = remaining[0];
    const dryRun = !!opts.dryRun;
    const merge = opts.merge !== false;

    const tracker = this.explorBot.getExperienceTracker();
    const files = this.resolveTarget(tracker, target);

    if (files === null) {
      tag('info').log('No experience files found.');
      return;
    }
    if (files.length === 0) {
      tag('info').log(`No experience files match target "${target}"`);
      return;
    }

    const compactor = this.explorBot.agentExperienceCompactor();

    if (dryRun) {
      this.printDryRun(compactor, files, target, !target && merge);
      this.suggestions = this.buildDryRunSuggestions(compactor, files, target);
      return;
    }

    if (!target) {
      const { merged, compacted } = await this.runFullSweep(compactor, merge);
      tag('success').log(`Done. ${merged} merged, ${compacted} compacted.`);
      this.suggestions = [{ command: 'experience', hint: 'list stored experiences' }];
      return;
    }

    tag('info').log(`Compacting ${files.length} experience file${files.length === 1 ? '' : 's'}…`);
    const compacted = await compactor.compactFiles(files);
    if (compacted === 0) {
      tag('info').log('No experience changes — nothing to strip and all content under size limit.');
    } else {
      tag('success').log(`Compacted ${compacted}/${files.length} experience file${files.length === 1 ? '' : 's'}.`);
    }
    this.suggestions = [{ command: `experience ${target}`, hint: 'view updated file' }];
  }

  private buildDryRunSuggestions(compactor: ReturnType<typeof this.explorBot.agentExperienceCompactor>, files: ExperienceFile[], target?: string): Suggestion[] {
    const wouldTouch = files.filter((f) => {
      const stripped = compactor.stripNonUsefulEntries(f.content);
      return stripped !== f.content || stripped.length >= COMPACT_THRESHOLD || compactor.isRecent(f);
    });
    if (wouldTouch.length === 0) return [];
    const argsPart = target ? ` ${target}` : '';
    const count = wouldTouch.length;
    return [{ command: `compact${argsPart}`, hint: `run compaction for real (${count} file${count === 1 ? '' : 's'} will be touched)` }];
  }

  private async runFullSweep(compactor: ReturnType<typeof this.explorBot.agentExperienceCompactor>, merge: boolean): Promise<{ merged: number; compacted: number }> {
    if (!merge) {
      tag('info').log('Compacting all experience files (merge skipped)…');
      const compacted = await compactor.compactFiles(this.explorBot.getExperienceTracker().getAllExperience());
      return { merged: 0, compacted };
    }

    tag('info').log('Merging experience files with similar URLs, then compacting all…');
    return compactor.compactAllExperiences();
  }

  private resolveTarget(tracker: ExperienceTracker, target?: string): ExperienceFile[] | null {
    const all = tracker.getAllExperience();
    if (all.length === 0) return null;
    if (!target) return all;

    if (target.endsWith('.md')) {
      const bare = target.slice(0, -3);
      const byFilename = all.find((f) => basename(f.filePath, '.md') === bare);
      return byFilename ? [byFilename] : [];
    }

    const filter = target.toLowerCase();
    return all.filter((f) => (f.data.url || '').toLowerCase().includes(filter));
  }

  private printDryRun(compactor: ReturnType<typeof this.explorBot.agentExperienceCompactor>, files: ExperienceFile[], target: string | undefined, willMerge: boolean): void {
    const lines: string[] = [];
    const title = target ? `Dry run — target: "${target}"` : 'Dry run — full sweep';
    lines.push(chalk.bold.underline.cyan(title));

    if (willMerge) {
      lines.push(chalk.dim('Merge step would run across all files before compaction.'));
    }

    let wouldStrip = 0;
    let wouldAiReview = 0;
    let wouldAiCompact = 0;
    let totalChars = 0;

    for (const file of files) {
      const chars = file.content.length;
      totalChars += chars;

      const stripped = compactor.stripNonUsefulEntries(file.content);
      const strippedChars = stripped.length;
      const charsRemoved = chars - strippedChars;
      const willStrip = stripped !== file.content;
      const willReview = compactor.isRecent(file);
      const willAi = strippedChars >= COMPACT_THRESHOLD;

      if (willStrip) wouldStrip++;
      if (willReview) wouldAiReview++;
      if (willAi) wouldAiCompact++;

      const name = basename(file.filePath);
      const url = file.data.url || chalk.dim('(no url)');

      const markers: string[] = [];
      if (willStrip) {
        const label = charsRemoved > 0 ? `✂ strip -${charsRemoved} chars` : '✂ strip (rewrite)';
        markers.push(chalk.yellow(label));
      }
      if (willReview) markers.push(chalk.magenta('✓ ai-review'));
      if (willAi) markers.push(chalk.yellow('✎ ai-compact'));
      if (markers.length === 0) markers.push(chalk.dim('· skip'));

      lines.push('');
      lines.push(chalk.bold.green(name));
      lines.push(`    ${chalk.cyan(url)}`);
      lines.push(`    ${chalk.dim('size:')} ${chars} chars  ${markers.join('  ')}`);
    }

    lines.push('');
    lines.push(chalk.bold('Summary'));
    lines.push(`  ${chalk.dim('Files matched:')}      ${chalk.bold(String(files.length))}`);
    lines.push(`  ${chalk.dim('Would strip:')}        ${chalk.bold(String(wouldStrip))} ${chalk.dim('(remove legacy / FAILED / Visual click, rename to FLOW/ACTION)')}`);
    lines.push(`  ${chalk.dim('Would ai-review:')}    ${chalk.bold(String(wouldAiReview))} ${chalk.dim('(recent files ≤30d — quality/reusability check)')}`);
    lines.push(`  ${chalk.dim('Would ai-compact:')}   ${chalk.bold(String(wouldAiCompact))} ${chalk.dim(`(over ${COMPACT_THRESHOLD} chars after strip)`)}`);
    lines.push(`  ${chalk.dim('Total chars:')}        ${chalk.bold(String(totalChars))}`);

    tag('info').log(lines.join('\n'));
  }
}
