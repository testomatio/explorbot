import { readFileSync, writeFileSync } from 'node:fs';
import { Plan, Test } from '../test-plan.ts';

export function parsePlanFromMarkdown(filePath: string): Plan {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  let title = '';
  let currentTest: Test | null = null;
  let inRequirements = false;
  let inSteps = false;
  let inExpected = false;
  let priority: 'high' | 'medium' | 'low' | 'unknown' = 'unknown';

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
      priority = (priorityMatch?.[1] as 'high' | 'medium' | 'low' | 'unknown') || 'unknown';
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
      priority = 'unknown';
    }
  }

  return plan;
}

export function savePlanToMarkdown(plan: Plan, filePath: string): void {
  let content = `<!-- suite -->\n# ${plan.title}\n\n`;

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

export function planToAiContext(plan: Plan): string {
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

    if (Object.keys(test.steps).length > 0) {
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
