import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import matter from 'gray-matter';
import type { ActionResult } from './action-result.js';
import { ConfigParser } from './config.js';

interface Knowledge {
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
    const configPath = configParser.getConfigPath();

    if (configPath) {
      const projectRoot = dirname(configPath);
      this.knowledgeDir = join(projectRoot, config.dirs?.knowledge || 'knowledge');
    } else {
      this.knowledgeDir = config.dirs?.knowledge || 'knowledge';
    }

    if (!existsSync(this.knowledgeDir)) {
      mkdirSync(this.knowledgeDir, { recursive: true });
    }
  }

  private loadKnowledgeFiles(): void {
    if (this.isLoaded) return;

    this.knowledgeFiles = [];

    if (!existsSync(this.knowledgeDir)) {
      return;
    }

    const files = readdirSync(this.knowledgeDir)
      .filter((file) => file.endsWith('.md'))
      .map((file) => join(this.knowledgeDir, file));

    for (const filePath of files) {
      try {
        const fileContent = readFileSync(filePath, 'utf8');
        const parsed = matter(fileContent);
        const urlPattern = parsed.data.url || parsed.data.path || '*';

        this.knowledgeFiles.push({
          filePath,
          url: urlPattern,
          content: parsed.content,
          ...parsed.data,
        });
      } catch (error) {
        // Skip invalid files
      }
    }

    this.isLoaded = true;
  }

  getRelevantKnowledge(state: ActionResult): Knowledge[] {
    this.loadKnowledgeFiles();

    return this.knowledgeFiles.filter((knowledge) => {
      return state.isMatchedBy(knowledge);
    });
  }

  addKnowledge(urlPattern: string, description: string): { filename: string; filePath: string; isNewFile: boolean } {
    const configParser = ConfigParser.getInstance();
    const config = configParser.getConfig();
    const configPath = configParser.getConfigPath();

    if (!configPath) {
      throw new Error('No explorbot configuration found. Please run "maclay init" first.');
    }

    const projectRoot = dirname(configPath);
    const knowledgeDir = join(projectRoot, config.dirs?.knowledge || 'knowledge');

    if (!existsSync(knowledgeDir)) {
      mkdirSync(knowledgeDir, { recursive: true });
    }

    const normalizedUrl = this.normalizeUrl(urlPattern);
    const filename = this.generateFilename(normalizedUrl);
    const filePath = join(knowledgeDir, filename);

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
        newContent = existingDescription + '\n\n---\n\n' + description;
      } else {
        newContent = description;
      }

      const fileContent = matter.stringify(newContent, frontmatter);
      writeFileSync(filePath, fileContent, 'utf8');
    }

    return { filename, filePath, isNewFile };
  }

  private generateFilename(url: string): string {
    let filename = url
      .replace(/https?:\/\//g, '')
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .toLowerCase();

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

  normalizeUrl(url: string): string {
    const trimmed = url.trim();

    if (!trimmed) {
      throw new Error('URL pattern cannot be empty');
    }

    return trimmed;
  }
}
