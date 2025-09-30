import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
}
