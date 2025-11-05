// Bunosh CLI required to execute tasks from this file
// Get it here => https://buno.sh
import fs from 'node:fs';
import dotenv from 'dotenv';
dotenv.config();
const highlight = require('cli-highlight').highlight;
import { htmlCombinedSnapshot, htmlTextSnapshot, minifyHtml } from './src/utils/html.js';
import { chromium } from 'playwright';
import yaml from 'js-yaml';

const { exec, shell, fetch, writeToFile, task, ai } = global.bunosh;

// input/output
const { say, ask, yell } = global.bunosh;

/**
 * 🎉 Hello world command
 */
export async function worktreeCreate(name = '') {
  const worktreeName = name || (await ask('What is feature name?'));

  const newDir = `../explorbot-${worktreeName}`;

  await exec`git worktree add ../explorbot-${worktreeName}`;
  await exec`ln -sf node_modules ${newDir}/node_modules`;

  say(`Created worktree for feature ${worktreeName} in ${newDir}`);
}

/**
 * Print HTML combined file for the given file name
 * @param {file} fileName
 */
export async function htmlCombined(fileName) {
  const html = fs.readFileSync(fileName, 'utf8');
  const combinedHtml = await minifyHtml(htmlCombinedSnapshot(html));
  console.log('----------');
  console.log(highlight(combinedHtml, { language: 'markdown' }));
}

export async function htmlAiText(fileName) {
  const html = fs.readFileSync(fileName, 'utf8');
  if (!html) {
    throw new Error('HTML file not found');
  }
  say(`Transforming HTML to markdown... ${html.length} characters`);
  const combinedHtml = await minifyHtml(htmlCombinedSnapshot(html));
  if (!combinedHtml) {
    throw new Error('HTML has no semantic elements');
  }
  console.log(combinedHtml);
  const result = await ai(`Transform into markdown. Identify headers, footers, asides, special application parts and main contant.
    Content should be in markdown format. If it is content: tables must be tables, lists must be lists. 
    Navigation elements should be represented as standalone blocks after the content.
    Do not summarize content, just transform it into markdown.
    It is important to list all the content text
    If it is link it must be linked
    You can summarize footers/navigation/aside elements. 
    But main conteint should be kept as text and formatted as markdown based on its current markup.

    Break down into sections:

    ## Content Area

    ## Navigation Area

    ## Footer & External Links Area

    Here is HTML:

    ${combinedHtml}
  `);
  console.log(highlight(result.output, { language: 'markdown' }));
}

/**
 * Open a page with Playwright and render accessibility tree in YAML format
 * @param {string} url - URL to open
 */
export async function htmlAccessibility(filename) {
  let targetUrl = filename;

  targetUrl = 'file://' + process.cwd() + '/' + filename;

  say(`Opening ${targetUrl} and analyzing accessibility tree...`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(targetUrl, { waitUntil: 'networkidle' });

    const accessibilityTree = await page.accessibility.snapshot();

    console.log(accessibilityTree);

    // const yamlOutput = yaml.dump(accessibilityTree, {
    //   indent: 2,
    //   lineWidth: 120,
    //   noRefs: true
    // });

    // console.log('----------');
    // console.log(highlight(yamlOutput, { language: 'yaml' }));
  } catch (error) {
    yell(`Error analyzing page: ${error.message}`);
  } finally {
    await browser.close();
  }
}
