import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { ConfigParser } from '../config.js';
import { log } from '../utils/logger.js';

export interface AddKnowledgeOptions {
  path?: string;
}

export async function addKnowledgeCommand(options: AddKnowledgeOptions = {}): Promise<void> {
  const customPath = options.path;

  try {
    // Get knowledge directory from config
    const configParser = ConfigParser.getInstance();
    let knowledgeDir: string;

    try {
      const config = configParser.getConfig();
      const configPath = configParser.getConfigPath();

      if (configPath) {
        const projectRoot = path.dirname(configPath);
        knowledgeDir = path.join(projectRoot, config.dirs?.knowledge || 'knowledge');
      } else {
        knowledgeDir = config.dirs?.knowledge || 'knowledge';
      }
    } catch (configError) {
      // If no config is found, use default
      knowledgeDir = 'knowledge';
    }

    // If custom path is provided, use it as the knowledge directory
    if (customPath) {
      knowledgeDir = path.resolve(customPath);
    }

    // Create knowledge directory if it doesn't exist
    if (!fs.existsSync(knowledgeDir)) {
      fs.mkdirSync(knowledgeDir, { recursive: true });
      log(`Created knowledge directory: ${knowledgeDir}`);
    }

    // Check for existing knowledge files to suggest URLs
    const existingFiles = findExistingKnowledgeFiles(knowledgeDir);
    const suggestedUrls = existingFiles
      .map((file) => {
        const parsed = matter.read(file);
        return parsed.data.url || parsed.data.path || '';
      })
      .filter((url) => url && url !== '*');

    // Interactive prompts
    console.log('Add Knowledge');
    console.log('=============');

    // Get URL pattern
    const urlPattern = await promptForInput('URL Pattern (e.g., /login, https://example.com/dashboard, *):', suggestedUrls.length > 0 ? suggestedUrls[0] : '');

    if (!urlPattern.trim()) {
      console.log('URL pattern is required');
      return;
    }

    // Get description
    const description = await promptForInput('Description (markdown supported):', '');

    if (!description.trim()) {
      console.log('Description is required');
      return;
    }

    // Create or update knowledge file
    await createOrUpdateKnowledgeFile(knowledgeDir, urlPattern, description);

    console.log(`Knowledge saved to: ${knowledgeDir}`);
  } catch (error) {
    log('Failed to add knowledge:', error);
    process.exit(1);
  }
}

function findExistingKnowledgeFiles(knowledgeDir: string): string[] {
  if (!fs.existsSync(knowledgeDir)) {
    return [];
  }

  const files: string[] = [];

  function scanDir(dir: string) {
    const items = fs.readdirSync(dir);

    for (const item of items) {
      const itemPath = path.join(dir, item);
      const stat = fs.statSync(itemPath);

      if (stat.isDirectory()) {
        scanDir(itemPath);
      } else if (item.endsWith('.md')) {
        files.push(itemPath);
      }
    }
  }

  scanDir(knowledgeDir);
  return files;
}

async function promptForInput(prompt: string, defaultValue = ''): Promise<string> {
  return new Promise((resolve) => {
    console.log(`${prompt}${defaultValue ? ` (default: ${defaultValue})` : ''}`);

    // Simple readline-like implementation
    process.stdin.setEncoding('utf8');
    process.stdin.resume();
    process.stdin.setRawMode(true);

    let input = '';

    process.stdin.on('data', (chunk: string) => {
      const char = chunk.toString();

      if (char === '\r' || char === '\n') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        console.log('');
        resolve(input.trim() || defaultValue);
      } else if (char === '\u0003') {
        // Ctrl+C
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.exit(0);
      } else if (char === '\u007f') {
        // Backspace
        input = input.slice(0, -1);
        process.stdout.write('\b \b');
      } else {
        input += char;
        process.stdout.write(char);
      }
    });

    if (defaultValue) {
      process.stdout.write(defaultValue);
      input = defaultValue;
    }
  });
}

async function createOrUpdateKnowledgeFile(knowledgeDir: string, urlPattern: string, description: string): Promise<void> {
  // Generate filename based on URL pattern
  let filename = urlPattern
    .replace(/https?:\/\//g, '') // Remove protocol
    .replace(/[^a-zA-Z0-9_]/g, '_') // Replace special chars with underscores
    .replace(/_+/g, '_') // Replace multiple underscores with single
    .replace(/^_|_$/g, '') // Remove leading/trailing underscores
    .toLowerCase();

  if (!filename || filename === '*') {
    filename = 'general';
  }

  // Add extension if not present
  if (!filename.endsWith('.md')) {
    filename += '.md';
  }

  const filePath = path.join(knowledgeDir, filename);

  // Check if file exists
  const fileExists = fs.existsSync(filePath);

  if (fileExists) {
    console.log(`Updating existing knowledge file: ${filename}`);
  } else {
    console.log(`Creating new knowledge file: ${filename}`);
  }

  // Create knowledge content with frontmatter
  const knowledgeContent = `---
url: ${urlPattern}
---

${description}
`;

  fs.writeFileSync(filePath, knowledgeContent, 'utf8');
}
