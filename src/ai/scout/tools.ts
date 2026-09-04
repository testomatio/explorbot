import { resolve } from 'node:path';
import { tool } from 'ai';
import dedent from 'dedent';
import { z } from 'zod';
import { tag } from '../../utils/logger.ts';
import { loadMarkdownFiles } from '../../utils/markdown-files.ts';
import { readCaptainFile } from '../captain/file-tools.ts';
import { MAX_HITS, searchMarkdown } from './search.ts';

const MAX_FILES = 500;
const MAX_FINDINGS = 6000;

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

export function createScoutTools(corpus: ScoutCorpus) {
  let finished = false;
  let result = '';
  let searchedOrRead = false;
  const excluded = new Set(corpus.excludedPaths.map((p) => canonicalPath(p)));

  const getResult = () => result;
  const isFinished = () => finished;
  const finishFromText = (text?: string) => {
    finished = true;
    if (text && searchedOrRead) result = text.slice(0, MAX_FINDINGS);
  };

  const tools: Record<string, any> = {
    searchDocs: tool({
      description: dedent`
        Search the documentation corpus for a word, phrase or regular expression.
        Returns matching lines with their file paths and line numbers.
        Use plain words the documentation would contain: feature names, page purposes, capabilities.
        Documents are prose — slashes, quotes and punctuation rarely appear in them.
      `,
      inputSchema: z.object({
        query: z.string().describe('Text or regular expression to find in the documentation'),
      }),
      execute: async ({ query }) => {
        tag('step').log(`Scout: search "${query}"`);
        searchedOrRead = true;
        const raw = await searchMarkdown(corpus.dirs, query);
        const hits = raw.filter((hit) => !excluded.has(canonicalPath(hit.path)));
        const output: Record<string, any> = { success: true, count: hits.length, hits };
        if (raw.length >= MAX_HITS) output.note = 'Results were capped — refine the query with more specific words to see further matches';
        return output;
      },
    }),

    readDoc: tool({
      description: dedent`
        Read one documentation file from the corpus.
        Pass the exact path returned by a searchDocs result.
      `,
      inputSchema: z.object({
        path: z.string().describe('File path from a searchDocs result'),
        maxChars: z.number().optional().describe('Maximum characters to return, default 12000'),
      }),
      execute: async (input) => {
        tag('step').log(`Scout: read ${input.path}`);
        const output = readCaptainFile(process.cwd(), input, corpus.dirs);
        if (!output.success) return output;

        if (excluded.has(canonicalPath(output.path || input.path))) {
          return { success: false, message: 'This page is already provided to the planner in full — scout the other pages' };
        }
        searchedOrRead = true;
        return output;
      },
    }),

    report: tool({
      description: dedent`
        Report the documentation findings for test planning.
        Include only what the documentation states, each item attributed to its page URL.
        Reporting that nothing relevant exists is a valid answer.
      `,
      inputSchema: z.object({
        findings: z.string().describe('Digest of documented capabilities, states and transitions, each attributed to its page URL'),
      }),
      execute: async ({ findings }) => {
        if (!searchedOrRead) {
          tag('warning').log('Scout: report rejected — nothing searched or read in this run');
          return { finished: false, error: 'Nothing was searched or read in this run, so there is nothing to report. Keep working, or report that the documentation contains nothing relevant.' };
        }

        tag('success').log('Scout reported findings');
        finished = true;
        result = findings.slice(0, MAX_FINDINGS);
        return { finished: true };
      },
    }),
  };

  return { tools, getResult, isFinished, finishFromText };
}

function canonicalPath(path: string): string {
  return resolve(process.cwd(), path).replace(/\\/g, '/');
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
