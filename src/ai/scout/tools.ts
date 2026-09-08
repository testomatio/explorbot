import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tool } from 'ai';
import { createBashTool } from 'bash-tool';
import dedent from 'dedent';
import { z } from 'zod';
import { ConfigParser } from '../../config.ts';
import { tag } from '../../utils/logger.ts';
import { loadMarkdownFiles } from '../../utils/markdown-files.ts';
import { readCaptainFile } from '../captain/file-tools.ts';

const MAX_FILES = 500;
const MAX_FINDINGS = 6000;

let cachedScanner: 'rg' | 'grep' | null = null;

export function loadScoutCorpus(dirs: string[]): ScoutCorpus {
  const files: ScoutCorpusFile[] = [];
  for (const dir of dirs) {
    if (files.length >= MAX_FILES) {
      tag('warning').log(`Scout corpus capped at ${MAX_FILES} files — remaining directories skipped`);
      break;
    }
    for (const file of loadMarkdownFiles(dir, { recursive: true })) {
      if (files.length >= MAX_FILES) break;
      const entry: ScoutCorpusFile = { path: file.filePath };
      if (typeof file.data.url === 'string') entry.url = file.data.url;
      files.push(entry);
    }
  }
  return { dirs, files, excludedPaths: [] };
}

export function excludeCorpusUrls(corpus: ScoutCorpus, urls: string[]): ScoutCorpus {
  if (urls.length === 0) return corpus;

  const excludedUrls = new Set(urls);
  const files: ScoutCorpusFile[] = [];
  const excludedPaths = [...corpus.excludedPaths];
  for (const file of corpus.files) {
    if (file.url && excludedUrls.has(file.url)) {
      excludedPaths.push(file.path);
      continue;
    }
    files.push(file);
  }
  return { dirs: corpus.dirs, files, excludedPaths };
}

export async function createScoutTools(corpus: ScoutCorpus) {
  const scanner = await detectScanner();
  const projectRoot = ConfigParser.getInstance().getProjectRoot();

  let result = '';
  let searchedOrRead = false;

  const getResult = () => result;
  const finishFromText = (text?: string) => {
    if (text && searchedOrRead) result = text.slice(0, MAX_FINDINGS);
  };

  const files: Record<string, string> = {};
  const readableFiles = new Set<string>();
  for (const file of corpus.files) {
    files[toPosix(file.path)] = readFileSync(file.path, 'utf8');
    readableFiles.add(resolve(file.path));
  }

  const toolkit = await createBashTool({
    destination: '/',
    files,
    maxOutputLength: 20000,
  });

  const bashExecute = toolkit.bash.execute;
  const bash = {
    ...toolkit.bash,
    execute: async (input: { command: string }) => {
      tag('step').log(`Scout: bash ${input.command}`);
      searchedOrRead = true;
      return bashExecute?.(input);
    },
  };

  const tools: Record<string, any> = {
    bash,
    readFile: tool({
      description: dedent`
        Read one documentation file from the corpus.
        Pass the exact path returned by a search result.
      `,
      inputSchema: z.object({
        path: z.string().describe('File path from a search result'),
        startLine: z.number().optional().describe('First line to read, 1-based. Negative values count from the end of the file'),
        endLine: z.number().optional().describe('Last line to read, 1-based and inclusive. Negative values count from the end of the file'),
        maxChars: z.number().optional().describe('Maximum characters to return, default 12000'),
      }),
      execute: async (input) => {
        tag('step').log(`Scout: read ${input.path}`);
        const output = readCaptainFile(projectRoot, input, corpus.dirs);
        if (!output.success) return output;
        const resolvedPath = resolve(projectRoot || process.cwd(), output.path);
        if (!readableFiles.has(resolvedPath)) {
          return { success: false, message: 'File is outside the Scout corpus' };
        }
        searchedOrRead = true;
        return output;
      },
    }),
  };

  return { tools, scanner, getResult, finishFromText };
}

async function detectScanner(): Promise<'rg' | 'grep'> {
  if (cachedScanner) return cachedScanner;
  if (await binaryRuns('rg')) {
    cachedScanner = 'rg';
    return cachedScanner;
  }
  if (await binaryRuns('grep')) {
    cachedScanner = 'grep';
    return cachedScanner;
  }
  throw new Error('Scout requires ripgrep or grep on PATH — neither was found');
}

async function binaryRuns(binary: 'rg' | 'grep'): Promise<boolean> {
  try {
    const proc = Bun.spawn([binary, '--version'], { stdout: 'ignore', stderr: 'ignore', stdin: 'ignore' });
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}

function toPosix(path: string): string {
  return path.split('\\').join('/');
}

export interface ScoutCorpus {
  dirs: string[];
  files: ScoutCorpusFile[];
  excludedPaths: string[];
}

export interface ScoutCorpusFile {
  path: string;
  url?: string;
}
