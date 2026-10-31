import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import dedent from 'dedent';
import { ActionResult } from './action-result.ts';
import { APPLICATION_SPEC_PAGE_SCHEMA } from './application-spec-contract.ts';
import { ConfigParser } from './config.ts';
import { tag } from './utils/logger.ts';
import { loadMarkdownFiles } from './utils/markdown-files.ts';

export class ApplicationSpec {
  private pages: ApplicationSpecPage[] = [];
  readonly sourcePath: string;
  private totalMarkdownFiles = 0;

  constructor(sourcePath: string) {
    this.sourcePath = this.resolveSourcePath(sourcePath);
    this.load();
  }

  renderFor(state: ActionResult): string {
    const relevant = this.relevantPages(state);
    if (relevant.length === 0) return '';

    tag('operation').log(`Found application specification for ${state.url}`);
    return dedent`
      <application_spec>
      This is previously collected application documentation. Treat User Can and observed state transitions as supporting context, not as a replacement for the current page state. Treat User Might as unverified possibilities that must be confirmed before use.

      ${relevant.map((page) => page.content).join('\n\n')}
      </application_spec>
    `;
  }

  matchedUrls(state: ActionResult): string[] {
    return this.relevantPages(state).map((page) => page.url);
  }

  get pageCount(): number {
    return this.pages.length;
  }

  get markdownFileCount(): number {
    return this.totalMarkdownFiles;
  }

  private load(): void {
    if (!existsSync(this.sourcePath)) {
      throw new Error(`Application spec not found: ${this.sourcePath}`);
    }

    const isDirectory = statSync(this.sourcePath).isDirectory();
    const bundlePath = isDirectory ? this.sourcePath : path.dirname(this.sourcePath);

    const allFiles = loadMarkdownFiles(bundlePath, { recursive: true });
    const indexPath = path.join(bundlePath, 'index.md');
    this.totalMarkdownFiles = allFiles.filter((file) => path.resolve(file.filePath) !== path.resolve(indexPath)).length;

    for (const file of allFiles) {
      if (path.resolve(file.filePath) === path.resolve(indexPath)) continue;

      if (!file.data.url && file.data.format === undefined && file.data.version === undefined) continue;

      const parsed = APPLICATION_SPEC_PAGE_SCHEMA.safeParse(file.data);
      if (!parsed.success && parsed.error.issues.some((issue) => issue.path[0] === 'format')) {
        throw new Error(`Invalid application spec format in ${file.filePath}`);
      }
      if (!parsed.success && parsed.error.issues.some((issue) => issue.path[0] === 'version')) {
        throw new Error(`Unsupported application spec version in ${file.filePath}: ${String(file.data.version)}`);
      }
      if (!parsed.success) {
        throw new Error(`Application spec page URL is missing in ${file.filePath}`);
      }
      this.pages.push({ url: parsed.data.url, content: file.content.trim() });
    }

    if (this.totalMarkdownFiles === 0) {
      tag('warning').log(`No markdown files found in spec: ${bundlePath}`);
      return;
    }

    if (this.pages.length === 0) {
      tag('debug').log(`${this.totalMarkdownFiles} spec files found in ${bundlePath}`);
      return;
    }
  }

  private resolveSourcePath(sourcePath: string): string {
    return resolveSpecSource(sourcePath);
  }

  private relevantPages(state: ActionResult): ApplicationSpecPage[] {
    return this.pages.filter((page) => state.isMatchedBy({ url: page.url }));
  }
}

export function resolveSpecBundlePath(sourcePath: string): string | null {
  const resolved = resolveSpecSource(sourcePath);
  if (!existsSync(resolved)) return null;
  if (statSync(resolved).isDirectory()) return resolved;
  return path.dirname(resolved);
}

function resolveSpecSource(sourcePath: string): string {
  if (path.isAbsolute(sourcePath)) return path.resolve(sourcePath);
  return path.resolve(ConfigParser.getInstance().resolveProjectDir(sourcePath));
}

interface ApplicationSpecPage {
  url: string;
  content: string;
}
