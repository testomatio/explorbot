import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ExplorBot, type ExplorBotOptions } from '../../../src/explorbot.ts';
import type { Link, WebPageState } from '../../../src/state-manager.ts';
import { normalizeUrl } from '../../../src/state-manager.ts';
import { sanitizeFilename } from '../../../src/utils/strings.ts';
import { tag } from '../../../src/utils/logger.ts';
import { Documentarian, type PageDocumentation } from './ai/documentarian.ts';
import { type DocbotConfig, DocbotConfigParser } from './config.ts';
import { type DocumentedPage, renderPageDocumentation, renderSpecIndex, type SkippedPage } from './docs-renderer.ts';
import { getDocPageKey, shouldCrawlDocPath } from './path-filter.ts';
import { extractResearchNavigationTargets } from './research-navigation.ts';

class DocBot {
  private explorBot: ExplorBot;
  private configParser: DocbotConfigParser;
  private config: DocbotConfig = {};
  private documentarian!: Documentarian;
  private options: DocbotOptions;
  private scopeRoot = '/';

  constructor(options: DocbotOptions = {}) {
    this.options = options;
    const baseUrl = this.extractAbsoluteBaseUrl(options.startUrl || '/');
    this.explorBot = new ExplorBot({
      baseUrl,
      verbose: options.verbose,
      config: options.config,
      path: options.path,
      show: options.show,
      headless: options.headless,
      incognito: options.incognito,
      session: options.session,
    });
    this.configParser = DocbotConfigParser.getInstance();
  }

  async start(): Promise<void> {
    await this.explorBot.start();
    this.config = await this.configParser.loadConfig({
      config: this.options.docsConfig,
      path: this.options.path,
    });
    this.documentarian = new Documentarian(this.explorBot.getProvider(), this.config);
    this.ensureDirectory(this.configParser.getOutputDir());
    this.ensureDirectory(this.getPagesDir());
  }

  async stop(): Promise<void> {
    await this.explorBot.stop();
  }

  async collect(startPath: string, opts: CollectOptions = {}): Promise<CollectionResult> {
    const effectiveStartPath = this.normalizeStartPath(startPath);
    this.scopeRoot = this.getScopeRoot(effectiveStartPath);
    const effectiveMaxPages = this.getMaxPages(opts.maxPages);
    const queue: string[] = [];
    const queued = new Set<string>();
    const documented = new Set<string>();
    const pages: DocumentedPage[] = [];
    const skipped: SkippedPage[] = [];
    const baseUrl = this.explorBot.getConfig().playwright.url;

    this.enqueuePath(effectiveStartPath, queue, queued);

    while (queue.length > 0 && pages.length < effectiveMaxPages) {
      const target = queue.shift();
      if (!target) {
        continue;
      }

      const targetKey = this.getPageKey(target);
      if (documented.has(targetKey)) {
        continue;
      }

      const stateManager = this.explorBot.getExplorer().getStateManager();
      if (stateManager.hasVisitedState(target)) {
        continue;
      }

      try {
        tag('info').log(`Collecting docs for ${this.toDisplayUrl(target, baseUrl)}`);
        await this.explorBot.visit(target);

        if (stateManager.isInDeadLoop()) {
          tag('warning').log('Dead loop detected during docs crawl, stopping collection');
          skipped.push({
            url: target,
            reason: 'dead loop detected during crawl',
          });
          break;
        }

        const state = this.explorBot.getCurrentState();
        if (!state) {
          skipped.push({
            url: target,
            reason: 'page state was not captured after navigation',
          });
          continue;
        }

        const pageKey = this.getPageKey(state.url || target);
        if (documented.has(pageKey)) {
          continue;
        }

        const research = await this.explorBot.agentResearcher().research(state, {
          screenshot: this.shouldUseScreenshots(),
          force: true,
        });
        const documentation = await this.documentarian.document(state, research);
        const lowSignalReason = this.getLowSignalReason(documentation, research);
        if (lowSignalReason) {
          skipped.push({
            url: state.url,
            reason: lowSignalReason,
          });
          documented.add(pageKey);
          continue;
        }
        const filePath = this.savePageDocumentation(state, documentation);

        pages.push({
          url: state.url,
          title: state.title || '',
          summary: documentation.summary,
          canCount: documentation.can.length,
          mightCount: documentation.might.length,
          canActions: documentation.can.map((item) => item.action),
          mightActions: documentation.might.map((item) => item.action),
          filePath,
        });
        documented.add(pageKey);

        const nextPaths = this.extractNextPaths(state, baseUrl, research);
        for (const nextPath of nextPaths) {
          if (documented.has(this.getPageKey(nextPath))) {
            continue;
          }
          if (stateManager.hasVisitedState(nextPath)) {
            continue;
          }
          this.enqueuePath(nextPath, queue, queued);
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        tag('warning').log(`Skipping ${target}: ${reason}`);
        skipped.push({
          url: target,
          reason,
        });
      }
    }

    const indexPath = this.saveIndex(effectiveStartPath, pages, skipped, effectiveMaxPages);

    return {
      pages,
      skipped,
      indexPath,
      outputDir: this.configParser.getOutputDir(),
    };
  }

  private getMaxPages(override?: number): number {
    if (override && override > 0) {
      return override;
    }

    const configured = this.config.docs?.maxPages;
    if (configured && configured > 0) {
      return configured;
    }

    return 100;
  }

  private shouldUseScreenshots(): boolean {
    const screenshot = this.config.docs?.screenshot;
    if (screenshot === false) {
      return false;
    }
    return true;
  }

  private extractNextPaths(state: WebPageState, baseUrl: string, research: string): string[] {
    const paths: string[] = [];
    const seen = new Set<string>();

    for (const link of state.links || []) {
      const nextPath = this.resolveLink(link, baseUrl);
      if (!nextPath) {
        continue;
      }
      if (!shouldCrawlDocPath(nextPath, this.config)) {
        continue;
      }
      if (!this.isInScope(nextPath)) {
        continue;
      }
      if (seen.has(nextPath)) {
        continue;
      }
      seen.add(nextPath);
      paths.push(nextPath);
    }

    for (const target of extractResearchNavigationTargets(state, research)) {
      if (!shouldCrawlDocPath(target, this.config)) {
        continue;
      }
      if (!this.isInScope(target)) {
        continue;
      }
      if (seen.has(target)) {
        continue;
      }
      seen.add(target);
      paths.push(target);
    }

    return paths;
  }

  private resolveLink(link: Link, baseUrl: string): string | null {
    let resolved: URL;

    try {
      resolved = new URL(link.url, baseUrl);
    } catch {
      return null;
    }

    const base = new URL(baseUrl);
    if (resolved.origin !== base.origin) {
      return null;
    }

    const pathName = resolved.pathname || '/';
    return `${pathName}${resolved.search}${resolved.hash}`;
  }

  private toDisplayUrl(target: string, baseUrl: string): string {
    try {
      return new URL(target, baseUrl).toString();
    } catch {
      return target;
    }
  }

  private enqueuePath(inputPath: string, queue: string[], queued: Set<string>): void {
    const normalized = normalizeUrl(inputPath);
    const pageKey = this.getPageKey(inputPath);
    if (queued.has(pageKey)) {
      return;
    }
    queued.add(pageKey);
    if (!inputPath.startsWith('/')) {
      queue.push(`/${normalized}`);
      return;
    }
    queue.push(inputPath);
  }

  private getPageKey(pageUrl: string): string {
    return getDocPageKey(pageUrl, this.config);
  }

  private normalizeStartPath(startPath: string): string {
    try {
      const parsed = new URL(startPath);
      return `${parsed.pathname || '/'}${parsed.search}${parsed.hash}`;
    } catch {
      return startPath;
    }
  }

  private extractAbsoluteBaseUrl(startPath: string): string | undefined {
    try {
      const parsed = new URL(startPath);
      return parsed.origin;
    } catch {
      return undefined;
    }
  }

  private isInScope(target: string): boolean {
    const normalized = this.normalizeStartPath(target);
    const scope = this.config.docs?.scope || 'site';

    if (scope === 'site') {
      return true;
    }

    if (scope === 'subtree') {
      return normalized === this.scopeRoot || normalized.startsWith(`${this.scopeRoot}/`);
    }

    if (scope === 'section') {
      return normalized === this.scopeRoot || normalized.startsWith(`${this.scopeRoot}/`) || normalized.startsWith(`${this.scopeRoot}-`);
    }

    return true;
  }

  private getScopeRoot(startPath: string): string {
    const normalized = this.normalizeStartPath(startPath);
    const parts = normalized.split('/').filter(Boolean);
    if (parts.length === 0) {
      return '/';
    }
    if (parts.length >= 4) {
      return `/${parts.slice(0, 4).join('/')}`;
    }
    return `/${parts.join('/')}`;
  }

  private getLowSignalReason(documentation: PageDocumentation, research: string): string | null {
    const minCanActions = this.config.docs?.minCanActions ?? 1;
    const minInteractiveElements = this.config.docs?.minInteractiveElements ?? 3;

    if (documentation.can.length >= minCanActions) {
      return null;
    }

    const interactiveCount = this.countInteractiveElements(research);
    if (interactiveCount >= minInteractiveElements) {
      return null;
    }

    return `low-signal page: only ${documentation.can.length} proven actions and ${interactiveCount} interactive elements`;
  }

  private countInteractiveElements(research: string): number {
    const matches = [...research.matchAll(/\((\d+) elements?\)/g)];
    return matches.reduce((sum, match) => sum + Number.parseInt(match[1], 10), 0);
  }

  private savePageDocumentation(state: WebPageState, documentation: PageDocumentation): string {
    const pagePath = this.getPageFilePath(state.url);
    writeFileSync(pagePath, renderPageDocumentation(state, documentation), 'utf8');
    return pagePath;
  }

  private saveIndex(startPath: string, pages: DocumentedPage[], skipped: SkippedPage[], maxPages: number): string {
    const indexPath = path.join(this.configParser.getOutputDir(), 'spec.md');
    writeFileSync(indexPath, renderSpecIndex(this.configParser.getOutputDir(), startPath, pages, skipped, maxPages), 'utf8');
    return indexPath;
  }

  private getPagesDir(): string {
    return path.join(this.configParser.getOutputDir(), 'pages');
  }

  private getPageFilePath(pageUrl: string): string {
    const normalized = normalizeUrl(pageUrl || '/');
    const baseName = sanitizeFilename(normalized || 'root');
    if (baseName) {
      return path.join(this.getPagesDir(), `${baseName}.md`);
    }
    return path.join(this.getPagesDir(), 'root.md');
  }

  private ensureDirectory(dirPath: string): void {
    if (existsSync(dirPath)) {
      return;
    }
    mkdirSync(dirPath, { recursive: true });
  }
}

interface DocbotOptions extends ExplorBotOptions {
  docsConfig?: string;
  startUrl?: string;
}

interface CollectOptions {
  maxPages?: number;
}

interface CollectionResult {
  pages: DocumentedPage[];
  skipped: SkippedPage[];
  indexPath: string;
  outputDir: string;
}

export { DocBot };
export type { DocbotOptions, CollectOptions, CollectionResult, DocumentedPage, SkippedPage };
