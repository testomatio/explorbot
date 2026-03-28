import { readFileSync, writeFileSync } from 'node:fs';
import { type Note, Plan, Test } from '../test-plan.ts';
import { mdq } from './markdown-query.ts';

const NOISE_PREFIXES = ['Test started', 'Finish requested:', 'Session name:'];

function isNoiseNote(message: string): boolean {
  return NOISE_PREFIXES.some((prefix) => message.startsWith(prefix));
}

function getPilotVerdict(notes: Record<string, Note>): string | null {
  for (const note of Object.values(notes)) {
    if (note.status === 'passed' && note.message.startsWith('Pilot:')) {
      return note.message.replace(/^Pilot:\s*/, '');
    }
  }
  return null;
}

function formatFailedNotes(notes: Record<string, Note>): string[] {
  const lines: string[] = [];
  for (const note of Object.values(notes)) {
    if (!note.status) continue;
    if (isNoiseNote(note.message)) continue;
    if (note.message.startsWith('Pilot:')) continue;
    if (note.status === 'passed') {
      lines.push(`  ${note.message}`);
    } else if (note.status === 'failed') {
      lines.push(`  FAILED ${note.message}`);
    }
  }
  return lines;
}

export function planToCompactAiContext(plan: Plan): string {
  const allTests = plan.getAllTests();
  const passed = allTests.filter((t) => t.result === 'passed');
  const failed = allTests.filter((t) => t.result === 'failed');
  const pending = allTests.filter((t) => !t.result);

  const summaryParts: string[] = [];
  if (passed.length > 0) summaryParts.push(`${passed.length} passed`);
  if (failed.length > 0) summaryParts.push(`${failed.length} failed`);
  if (pending.length > 0) summaryParts.push(`${pending.length} pending`);

  let content = `${allTests.length} tests (${summaryParts.join(', ')})\n`;

  if (passed.length > 0) {
    content += '\n## Passed\n';
    for (const test of passed) {
      content += `- [${test.priority}]${test.style ? ` [${test.style}]` : ''} "${test.scenario}"\n`;
      if (test.startUrl) content += `  url: ${test.startUrl}\n`;
      const verdict = getPilotVerdict(test.notes);
      if (verdict) content += `  Verdict: ${verdict}\n`;
    }
  }

  if (failed.length > 0) {
    content += '\n## Failed\n';
    for (const test of failed) {
      content += `- [${test.priority}]${test.style ? ` [${test.style}]` : ''} "${test.scenario}"\n`;
      if (test.startUrl) content += `  url: ${test.startUrl}\n`;
      const noteLines = formatFailedNotes(test.notes);
      content += noteLines.join('\n');
      if (noteLines.length > 0) content += '\n';
    }
  }

  if (pending.length > 0) {
    content += '\n## Pending\n';
    for (const test of pending) {
      content += `- [${test.priority}] "${test.scenario}"\n`;
    }
  }

  return content;
}

export function parsePlanFromMarkdown(filePath: string): Plan {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  let title = '';
  let currentTest: Test | null = null;
  let inRequirements = false;
  let inSteps = false;
  let inExpected = false;
  let priority: 'critical' | 'important' | 'high' | 'normal' | 'low' = 'normal';

  const plan = new Plan('');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith('<!-- suite -->') && !plan.title) {
      title = lines[i + 1]?.replace(/^#\s+/, '') || '';
      plan.title = title;
      i++;
      continue;
    }

    if (line.startsWith('<!-- test')) {
      currentTest = null;
      const priorityMatch = line.match(/priority:\s*(\w+)/);
      priority = (priorityMatch?.[1] as 'critical' | 'important' | 'high' | 'normal' | 'low') || 'normal';
      continue;
    }

    if (line.startsWith('# ') && currentTest === null) {
      const scenario = line.replace(/^#\s+/, '');
      currentTest = new Test(scenario, priority, [], '');
      plan.addTest(currentTest);
      inRequirements = false;
      inSteps = false;
      inExpected = false;
      continue;
    }

    if (currentTest && line === '## Requirements') {
      inRequirements = true;
      inSteps = false;
      inExpected = false;
      continue;
    }

    if (currentTest && line === '## Steps') {
      inRequirements = false;
      inSteps = true;
      inExpected = false;
      continue;
    }

    if (currentTest && line === '## Expected') {
      inRequirements = false;
      inSteps = false;
      inExpected = true;
      continue;
    }

    if (currentTest && inRequirements && line && !line.startsWith('##')) {
      currentTest.startUrl = line;
      continue;
    }

    if (currentTest && inSteps && line.startsWith('* ')) {
      let step = line.replace(/^\*\s+/, '');

      let j = i + 1;
      while (j < lines.length) {
        const nextLine = lines[j];
        const trimmedNext = nextLine.trim();

        if (nextLine.match(/^\*\s+/)) {
          break;
        }

        if (trimmedNext.startsWith('##') || trimmedNext.startsWith('<!--')) {
          break;
        }

        if (nextLine.startsWith('  ')) {
          step += '\n' + nextLine;
          j++;
        } else if (trimmedNext === '') {
          break;
        } else {
          break;
        }
      }

      currentTest.plannedSteps.push(step);
      i = j - 1;
      continue;
    }

    if (currentTest && inExpected && line.startsWith('* ')) {
      let expectation = line.replace(/^\*\s+/, '');

      let j = i + 1;
      while (j < lines.length) {
        const nextLine = lines[j];
        const trimmedNext = nextLine.trim();

        if (nextLine.match(/^\*\s+/)) {
          break;
        }

        if (trimmedNext.startsWith('##') || trimmedNext.startsWith('<!--')) {
          break;
        }

        if (nextLine.startsWith('  ')) {
          expectation += '\n' + nextLine;
          j++;
        } else if (trimmedNext === '') {
          break;
        } else {
          break;
        }
      }

      currentTest.expected.push(expectation);
      i = j - 1;
      continue;
    }

    if (line.startsWith('<!-- test -->') || line.startsWith('<!-- suite -->')) {
      currentTest = null;
      inRequirements = false;
      inExpected = false;
      priority = 'normal';
    }
  }

  const firstItem = mdq(content).query('section[0] item[0]').text().trim();
  const urlMatch = firstItem.match(/^URL:\s*(.+)/);
  if (urlMatch) {
    plan.url = urlMatch[1].replace(/\*\*|`|\*|_|~~?/g, '').trim();
    for (const test of plan.tests) {
      if (!test.startUrl) test.startUrl = plan.url;
    }
  }

  return plan;
}

export function savePlanToMarkdown(plan: Plan, filePath: string): void {
  let content = `<!-- suite -->\n# ${plan.title}\n\n`;

  if (plan.url) {
    content += `### Prerequisite\n\n* URL: ${plan.url}\n\n`;
  }

  if (plan.iteration > 0) {
    content += `<!-- plan updated on ${new Date().toISOString()} -->\n\n`;
  }

  for (const test of plan.tests) {
    content += `<!-- test\npriority: ${test.priority}\n-->\n`;
    content += `# ${test.scenario}\n\n`;
    content += '## Requirements\n';
    content += `${test.startUrl || 'Current page'}\n\n`;

    if (test.plannedSteps.length > 0) {
      content += '## Steps\n';
      for (const step of test.plannedSteps) {
        const lines = step.split('\n');
        content += `* ${lines[0]}\n`;

        for (let i = 1; i < lines.length; i++) {
          content += `${lines[i]}\n`;
        }
      }
      content += '\n';
    }

    content += '## Expected\n';

    for (const expectation of test.expected) {
      const lines = expectation.split('\n');
      content += `* ${lines[0]}\n`;

      for (let i = 1; i < lines.length; i++) {
        content += `${lines[i]}\n`;
      }
    }

    content += '\n';
  }

  writeFileSync(filePath, content, 'utf-8');
}

export function planToAiContext(plan: Plan, options?: { skipSteps?: boolean }): string {
  let content = `# Test Plan: ${plan.title}\n\n`;

  if (plan.url) {
    content += `**URL:** ${plan.url}\n\n`;
  }

  content += `**Total Tests:** ${plan.tests.length}\n`;
  content += `**Status:** ${plan.isComplete ? 'Complete' : 'In Progress'}\n\n`;

  for (let i = 0; i < plan.tests.length; i++) {
    const test = plan.tests[i];
    content += `## Test ${i + 1}: ${test.scenario}\n\n`;
    content += `**Priority:** ${test.priority}\n`;
    content += `**Status:** ${test.status}\n`;
    if (test.result) {
      content += `**Result:** ${test.result}\n`;
    }
    content += '\n';

    if (test.startUrl) {
      content += `**Start URL:** ${test.startUrl}\n\n`;
    }

    if (test.plannedSteps.length > 0) {
      content += '**Planned Steps:**\n';
      for (const step of test.plannedSteps) {
        content += `- ${step}\n`;
      }
      content += '\n';
    }

    if (test.expected.length > 0) {
      content += '**Expected Outcomes:**\n';
      for (const expectation of test.expected) {
        content += `- ${expectation}\n`;
      }
      content += '\n';
    }

    if (!options?.skipSteps && Object.keys(test.steps).length > 0) {
      content += '**Steps:**\n';
      for (const step of Object.values(test.steps)) {
        content += `- ${step.text}\n`;
      }
      content += '\n';
    }

    if (Object.keys(test.notes).length > 0) {
      content += '**Notes:**\n';
      for (const note of test.getPrintableNotes()) {
        content += `${note}\n`;
      }
      content += '\n';
    }

    content += '---\n\n';
  }

  return content;
}
