// Bunosh CLI required to execute tasks from this file
// Get it here => https://buno.sh
import fs from 'node:fs';
const highlight = require('cli-highlight').highlight
const turndown = require('turndown')
import { htmlCombinedSnapshot, htmlTextSnapshot, minifyHtml } from './src/utils/html.js';

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

/**
 * Print HTML text for this file
 * @param {file} fileName 
 */
export async function htmlText(fileName) {
  var TurndownService = require('turndown')
  const html = fs.readFileSync(fileName, 'utf8');
  let combinedHtml = await minifyHtml(htmlCombinedSnapshot(html));
  var turndownService = new TurndownService()
  combinedHtml = turndownService.turndown(combinedHtml.replaceAll('\n', ''));
  console.log('----------');
  console.log(combinedHtml);
  // console.log(highlight(combinedHtml, { language: 'markdown' }));
}