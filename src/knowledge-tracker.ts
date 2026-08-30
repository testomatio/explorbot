import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import dedent from 'dedent';
import matter from 'gray-matter';
import { ActionResult } from './action-result.js';
import { ApplicationSpec } from './application-spec.ts';
import { ConfigParser } from './config.js';
import { getCliName } from './utils/cli-name.ts';
import { createDebug, pluralize, tag } from './utils/logger.js';
import { loadMarkdownFiles } from './utils/markdown-files.js';
import { mdq } from './utils/markdown-query.js';
import { isSecretName, registerSecret } from './utils/secrets.js';
import { slugify } from './utils/strings.js';
import { extractStatePath, matchesUrl } from './utils/url-matcher.js';

const debugLog = createDebug('explorbot:knowledge-tracker');

export interface Knowledge {
  filePath: string;
  url: string;
  content: string;
  [key: string]: any;
}

let knowledgeFromOption: string[] = [];

export function registerKnowledgeOption(program: Command): void {
  program.option('--knowledge <text>', 'Knowledge for this run only, not saved to disk. Markdown text; add url: or endpoint: frontmatter to scope it, otherwise it applies everywhere. Repeatable', (value: string, previous: string[] = []) => [...previous, value]);
  program.hook('preAction', (_thisCommand, actionCommand) => {
    knowledgeFromOption = actionCommand.optsWithGlobals().knowledge || [];
  });
}

export class KnowledgeTracker {
  private knowledgeDir: string;
  private knowledgeFiles: Knowledge[] = [];
  private sessionKnowledge: Knowledge[] = [];
  private isLoaded = false;
  private applicationSpec?: ApplicationSpec;

  constructor(options: KnowledgeTrackerOptions = {}) {
    let knowledgeDir = options.knowledgeDir;
    let specPath = options.applicationSpec;

    if (!knowledgeDir) {
      const configParser = ConfigParser.getInstance();
      const config = configParser.getConfig();
      knowledgeDir = configParser.resolveProjectDir(config.dirs?.knowledge || 'knowledge');
      specPath ||= config.dirs?.spec;
    }

    this.knowledgeDir = knowledgeDir;

    if (!existsSync(this.knowledgeDir)) {
      mkdirSync(this.knowledgeDir, { recursive: true });
    }

    if (specPath) {
      this.applicationSpec = new ApplicationSpec(specPath);
      tag('info').log(`Loaded application spec with ${this.applicationSpec.pageCount} documented pages`);
    }

    this.sessionKnowledge = this.parseSessionKnowledge(options.knowledge ?? knowledgeFromOption);
  }

  private loadKnowledgeFiles(): void {
    if (this.isLoaded) return;

    this.knowledgeFiles = [];

    for (const entry of loadMarkdownFiles(this.knowledgeDir, { recursive: true })) {
      this.knowledgeFiles.push({
        filePath: entry.filePath,
        url: entry.data.url || entry.data.path || '*',
        content: this.interpolateVars(entry.content),
        ...entry.data,
      });
    }

    this.isLoaded = true;
  }

  getRelevantKnowledge(state: ActionResult): Knowledge[] {
    this.loadKnowledgeFiles();

    return this.allKnowledge().filter((knowledge) => {
      return state.isMatchedBy(knowledge);
    });
  }

  getEndpointKnowledge(endpoint: string): Knowledge[] {
    this.loadKnowledgeFiles();
    const path = extractStatePath(endpoint);

    return this.allKnowledge().filter((knowledge) => knowledge.endpoint && matchesUrl(knowledge.endpoint, path));
  }

  renderRelevantKnowledge(state: ActionResult): string {
    return this.renderKnowledge(this.getRelevantKnowledge(state), 'page');
  }

  renderEndpointKnowledge(endpoint: string): string {
    return this.renderKnowledge(this.getEndpointKnowledge(endpoint), 'endpoint');
  }

  renderRelevantContext(state: ActionResult): string {
    return [this.renderRelevantKnowledge(state), this.renderApplicationSpec(state)].filter(Boolean).join('\n\n');
  }

  renderApplicationSpec(state: ActionResult): string {
    return this.applicationSpec?.renderFor(state) || '';
  }

  addKnowledge(urlPattern: string, description: string, opts?: { replace?: boolean }): { filename: string; filePath: string; isNewFile: boolean } {
    const configParser = ConfigParser.getInstance();
    const configPath = configParser.getConfigPath();

    if (!configPath) {
      throw new Error(`No explorbot configuration found. Please run "${getCliName()} init" first.`);
    }

    if (!existsSync(this.knowledgeDir)) {
      mkdirSync(this.knowledgeDir, { recursive: true });
    }

    const normalizedUrl = this.normalizeUrl(urlPattern);
    const filename = this.generateFilename(normalizedUrl);
    const filePath = join(this.knowledgeDir, filename);

    const isNewFile = !existsSync(filePath);

    if (isNewFile) {
      const frontmatter = {
        url: normalizedUrl,
        title: '', // Can be populated later
      };
      const fileContent = matter.stringify(description, frontmatter);
      writeFileSync(filePath, fileContent, 'utf8');
    } else {
      const existingContent = readFileSync(filePath, 'utf8');
      const parsed = matter(existingContent);

      // Update URL in frontmatter if different
      const frontmatter = { ...parsed.data, url: normalizedUrl };
      const existingDescription = parsed.content.trim();

      // Append new knowledge with separator
      let newContent;
      if (opts?.replace || !existingDescription) {
        newContent = description;
      } else {
        newContent = `${existingDescription}\n\n---\n\n${description}`;
      }

      const fileContent = matter.stringify(newContent, frontmatter);
      writeFileSync(filePath, fileContent, 'utf8');
    }

    this.isLoaded = false;

    return { filename, filePath, isNewFile };
  }

  private interpolateVars(content: string): string {
    return content.replace(/\$\{([^}]+)\}/g, (match, expr: string) => {
      const dotIndex = expr.indexOf('.');
      if (dotIndex === -1) return match;

      const namespace = expr.slice(0, dotIndex);
      const key = expr.slice(dotIndex + 1);

      if (namespace === 'env') {
        const value = process.env[key] ?? '';
        if (isSecretName(key)) registerSecret(value);
        return value;
      }

      if (namespace === 'config') {
        if (isSecretName(key)) return '';
        const config = ConfigParser.getInstance().getConfig();
        const value = key.split('.').reduce((obj: any, k) => obj?.[k], config);
        if (value !== undefined && typeof value !== 'object') return String(value);
        return '';
      }

      return match;
    });
  }

  private generateFilename(url: string): string {
    let filename = slugify(url.replace(/https?:\/\//g, ''));

    if (!filename || filename === '*') {
      filename = 'general';
    }

    if (!filename.endsWith('.md')) {
      filename += '.md';
    }

    return filename;
  }

  getExistingUrls(): string[] {
    this.loadKnowledgeFiles();

    return this.knowledgeFiles.map((knowledge) => knowledge.url).filter((url) => url && url !== '*');
  }

  getKnowledgeForUrl(urlPattern: string): string[] {
    this.loadKnowledgeFiles();
    const normalizedUrl = this.normalizeUrl(urlPattern);

    return this.knowledgeFiles.filter((knowledge) => knowledge.url === normalizedUrl).map((knowledge) => knowledge.content.trim());
  }

  listAllKnowledge(): Array<{ url: string; firstLine: string; filePath: string }> {
    this.loadKnowledgeFiles();

    return this.knowledgeFiles.map((knowledge) => {
      const content = knowledge.content.trim();
      const firstLine = mdq(content).meta()[0]?.text.split('\n')[0]?.trim() || '';
      return {
        url: knowledge.url,
        firstLine,
        filePath: knowledge.filePath,
      };
    });
  }

  getMatchingKnowledge(url: string): Knowledge[] {
    this.loadKnowledgeFiles();
    const state = new ActionResult({ url });
    return this.getRelevantKnowledge(state);
  }

  normalizeUrl(url: string): string {
    const trimmed = url.trim();

    if (!trimmed) {
      throw new Error('URL pattern cannot be empty');
    }

    return trimmed;
  }

  getStateParameters(state: ActionResult, keys: string[]) {
    const relevantKnowledge = this.getRelevantKnowledge(state);
    const result: Record<string, any> = {};

    for (const key of keys) {
      for (const knowledge of relevantKnowledge) {
        if (knowledge[key] !== undefined && result[key] === undefined) {
          result[key] = knowledge[key];
        }
      }
    }

    return result;
  }

  private allKnowledge(): Knowledge[] {
    return [...this.knowledgeFiles, ...this.sessionKnowledge];
  }

  private renderKnowledge(knowledgeFiles: Knowledge[], scope: string): string {
    if (knowledgeFiles.length === 0) return '';

    const knowledgeContent = knowledgeFiles
      .map((k) => k.content)
      .filter((k) => !!k)
      .join('\n\n');

    tag('operation').log(`Found ${knowledgeFiles.length} relevant knowledge ${pluralize(knowledgeFiles.length, 'file')}`);
    return dedent`
      <knowledge>
      Here is relevant knowledge for this ${scope}:

      ${knowledgeContent}
      </knowledge>
    `;
  }

  private parseSessionKnowledge(entries?: string[]): Knowledge[] {
    if (!entries?.length) return [];

    return entries.map((entry, index) => {
      const parsed = matter(entry);
      const knowledge: Knowledge = {
        filePath: `--knowledge #${index + 1}`,
        url: parsed.data.url || parsed.data.path || '*',
        content: this.interpolateVars(parsed.content.trim()),
        ...parsed.data,
      };

      if (!parsed.data.url && !parsed.data.path && !parsed.data.endpoint) knowledge.endpoint = '*';
      debugLog(`Session knowledge for ${knowledge.url}`);

      return knowledge;
    });
  }
}

export interface KnowledgeTrackerOptions {
  applicationSpec?: string;
  knowledge?: string[];
  knowledgeDir?: string;
}
