// Bunosh CLI required to execute tasks from this file
// Get it here => https://buno.sh
import fs from 'node:fs';
const highlight = require('cli-highlight').highlight;
import yaml from 'js-yaml';
import { chromium } from 'playwright';
import { htmlCombinedSnapshot, htmlTextSnapshot, minifyHtml } from './src/utils/html.js';
import { analyzeDemoCandidates, createDemoVideo } from './.claude/skills/demo-video/demo-video.ts';

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
 * List demo-worthy segments from an Explorbot session log
 * @param {string} log - Path to explorbot.log
 * @param {object} options
 * @param {string} [options.screencasts=output/screencasts] - Directory with .webm screencasts
 * @param {string} [options.duration=30] - Target video duration in seconds
 */
export async function demoAnalyze(log = 'output/explorbot.log', options = { screencasts: 'output/screencasts', duration: 30 }) {
  const candidates = await analyzeDemoCandidates({ log, screencasts: options.screencasts, duration: options.duration });
  if (!candidates.length) {
    yell('No demo-worthy segments found');
    return;
  }
  for (const [i, c] of candidates.entries()) {
    say(`#${i + 1} [${c.score}] ${c.scenario}`);
    say(`   ${c.webm}`);
    say(`   window ${c.windowStart}s → ${c.windowEnd}s, speed ${c.speed}x → ${c.outDur}s, ${c.visualSteps} steps (unique ${c.uniqueSteps}, ${c.successNotes} success notes)`);
  }
}

/**
 * Generate a demo video from an Explorbot run: browser screencast + terminal replaying real logs
 * @param {string} scenario - Scenario name substring to pick a test (empty = best segment)
 * @param {object} options
 * @param {string} [options.log=output/explorbot.log] - Path to explorbot.log
 * @param {string} [options.screencasts=output/screencasts] - Directory with .webm screencasts
 * @param {string} [options.duration=30] - Target duration in seconds (max 1.25x speedup)
 * @param {string} [options.size=landscape] - landscape | square | vertical | WxH
 * @param {string} [options.output] - Output MP4 path
 * @param {string} [options.appTitle] - Browser window title (default: app host from log)
 * @param {string} [options.terminalTheme=dark] - dark | light
 * @param {string} [options.bgImage=auto] - auto | gradient | none | path | URL
 */
export async function demoVideo(scenario = '', options = { log: 'output/explorbot.log', screencasts: 'output/screencasts', duration: 30, size: 'landscape', output: '', appTitle: '', terminalTheme: 'dark', bgImage: 'auto' }) {
  const summary = await createDemoVideo({ scenario, ...options });
  say(`Video: ${summary.output}`);
  say(`Scenario: ${summary.scenario} (${summary.outDur}s @ ${summary.speed}x)`);
  say(`Background: ${summary.background}`);
  for (const warning of summary.warnings) {
    say(`⚠ ${warning}`);
  }
  if (!summary.check.ok) {
    yell(`Output check failed: ${summary.check.issues.join('; ')}`);
    return;
  }
  say(`Check frames: ${summary.frames.map((f) => f.split('/').pop()).join(', ')}`);
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
