import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import dedent from 'dedent';
import matter from 'gray-matter';
import { ActionResult } from './action-result.js';
import { ConfigParser } from './config.js';
import { getCliName } from './utils/cli-name.ts';
import { createDebug, pluralize, tag } from './utils/logger.js';
import { loadMarkdownFiles } from './utils/markdown-files.js';
import { mdq } from './utils/markdown-query.js';
import { isSecretName, registerSecret } from './utils/secrets.js';
import { slugify } from './utils/strings.js';

const debugLog = createDebug('explorbot:knowledge-tracker');

export interface Knowledge {
  filePath: string;
  url: string;
  content: string;
  [key: string]: any;
}

export class KnowledgeTracker {
  private knowledgeDir: string;
  private knowledgeFiles: Knowledge[] = [];
  private isLoaded = false;

  constructor() {
    const configParser = ConfigParser.getInstance();
    const config = configParser.getConfig();
    this.knowledgeDir = configParser.resolveProjectDir(config.dirs?.knowledge || 'knowledge');

    if (!existsSync(this.knowledgeDir)) {
      mkdirSync(this.knowledgeDir, { recursive: true });
    }
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

    return this.knowledgeFiles.filter((knowledge) => {
      return state.isMatchedBy(knowledge);
    });
  }

  renderRelevantKnowledge(state: ActionResult): string {
    const knowledgeFiles = this.getRelevantKnowledge(state);
    if (knowledgeFiles.length === 0) return '';

    const knowledgeContent = knowledgeFiles
      .map((k) => k.content)
      .filter((k) => !!k)
      .join('\n\n');

    tag('operation').log(`Found ${knowledgeFiles.length} relevant knowledge ${pluralize(knowledgeFiles.length, 'file')}`);
    return dedent`
      <knowledge>
      Here is relevant knowledge for this page:

      ${knowledgeContent}
      </knowledge>
    `;
  }

  addKnowledge(urlPattern: string, description: string): { filename: string; filePath: string; isNewFile: boolean } {
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
      if (existingDescription) {
        newContent = `${existingDescription}\n\n---\n\n${description}`;
      } else {
        newContent = description;
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
}
