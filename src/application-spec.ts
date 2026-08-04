import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import dedent from 'dedent';
import { ActionResult } from './action-result.ts';
import { APPLICATION_SPEC_FORMAT, APPLICATION_SPEC_VERSION } from './application-spec-contract.ts';
import { ConfigParser } from './config.ts';
import { tag } from './utils/logger.ts';
import { loadMarkdownFiles } from './utils/markdown-files.ts';

export class ApplicationSpec {
  private pages: ApplicationSpecPage[] = [];
  readonly sourcePath: string;

  constructor(sourcePath: string) {
    this.sourcePath = this.resolveSourcePath(sourcePath);
    this.load();
  }

  renderFor(state: ActionResult): string {
    const relevant = this.pages.filter((page) => state.isMatchedBy({ url: page.url }));
    if (relevant.length === 0) return '';

    tag('operation').log(`Found application specification for ${state.url}`);
    return dedent`
      <application_spec>
      This is previously collected application documentation. Treat User Can and observed state transitions as supporting context, not as a replacement for the current page state. Treat User Might as unverified possibilities that must be confirmed before use.

      ${relevant.map((page) => page.content).join('\n\n')}
      </application_spec>
    `;
  }

  get pageCount(): number {
    return this.pages.length;
  }

  private load(): void {
    if (!existsSync(this.sourcePath)) {
      throw new Error(`Application spec not found: ${this.sourcePath}`);
    }

    const isDirectory = statSync(this.sourcePath).isDirectory();
    if (!isDirectory && path.basename(this.sourcePath).toLowerCase() !== 'index.md') {
      throw new Error(`Application spec file must be index.md: ${this.sourcePath}`);
    }

    const bundlePath = isDirectory ? this.sourcePath : path.dirname(this.sourcePath);
    const indexPath = path.join(bundlePath, 'index.md');
    if (!existsSync(indexPath)) {
      throw new Error(`Application spec index not found: ${indexPath}`);
    }

    const pagesPath = path.join(bundlePath, 'pages');
    if (!existsSync(pagesPath)) {
      throw new Error(`Application spec pages directory not found: ${pagesPath}`);
    }

    for (const file of loadMarkdownFiles(pagesPath, { recursive: true })) {
      if (file.data.format !== APPLICATION_SPEC_FORMAT) {
        throw new Error(`Invalid application spec format in ${file.filePath}`);
      }
      if (file.data.version !== APPLICATION_SPEC_VERSION) {
        throw new Error(`Unsupported application spec version in ${file.filePath}: ${String(file.data.version)}`);
      }
      const url = String(file.data.url || '').trim();
      if (!url) {
        throw new Error(`Application spec page URL is missing in ${file.filePath}`);
      }
      this.pages.push({ url, content: file.content.trim() });
    }

    if (this.pages.length === 0) {
      throw new Error(`Application spec contains no documented pages: ${pagesPath}`);
    }
  }

  private resolveSourcePath(sourcePath: string): string {
    if (path.isAbsolute(sourcePath)) return path.resolve(sourcePath);
    const configParser = ConfigParser.getInstance();
    return path.resolve(configParser.resolveProjectDir(sourcePath));
  }
}

interface ApplicationSpecPage {
  url: string;
  content: string;
}
