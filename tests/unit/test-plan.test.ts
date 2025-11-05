import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Plan, Test } from '../../src/test-plan.ts';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

describe('Plan', () => {
  const testFilePath = join('/tmp', 'test-plan.md');

  afterEach(() => {
    try {
      unlinkSync(testFilePath);
    } catch {
      // ignore if file doesn't exist
    }
  });

  describe('fromMarkdown', () => {
    test('should parse multiline expectations with indented content', () => {
      const markdown = `<!-- suite -->
# Test Suite

<!-- test
priority: high
-->
# Test Scenario

## Requirements
/test-page

## Expected
* Step title
  Step multiline content
  Additional line
* Another expectation

<!-- test -->
`;

      writeFileSync(testFilePath, markdown, 'utf-8');
      const plan = Plan.fromMarkdown(testFilePath);

      expect(plan.title).toBe('Test Suite');
      expect(plan.tests.length).toBe(1);
      expect(plan.tests[0].scenario).toBe('Test Scenario');
      expect(plan.tests[0].expected.length).toBe(2);
      expect(plan.tests[0].expected[0]).toBe('Step title\n  Step multiline content\n  Additional line');
      expect(plan.tests[0].expected[1]).toBe('Another expectation');
    });

    test('should parse expectations with formatted content like tables', () => {
      const markdown = `<!-- suite -->
# Test Suite

<!-- test
priority: medium
-->
# Table Test

## Requirements
/test-page

## Expected
* Verify table structure
  | Column 1 | Column 2 |
  | -------- | -------- |
  | Data 1   | Data 2   |
  *Expected*: Table should display correctly

<!-- test -->
`;

      writeFileSync(testFilePath, markdown, 'utf-8');
      const plan = Plan.fromMarkdown(testFilePath);

      expect(plan.tests[0].expected.length).toBe(1);
      expect(plan.tests[0].expected[0]).toContain('Verify table structure');
      expect(plan.tests[0].expected[0]).toContain('| Column 1 | Column 2 |');
      expect(plan.tests[0].expected[0]).toContain('*Expected*: Table should display correctly');
    });

    test('should handle single-line expectations', () => {
      const markdown = `<!-- suite -->
# Test Suite

<!-- test
priority: low
-->
# Simple Test

## Requirements
/test-page

## Expected
* Simple expectation
* Another simple expectation

<!-- test -->
`;

      writeFileSync(testFilePath, markdown, 'utf-8');
      const plan = Plan.fromMarkdown(testFilePath);

      expect(plan.tests[0].expected.length).toBe(2);
      expect(plan.tests[0].expected[0]).toBe('Simple expectation');
      expect(plan.tests[0].expected[1]).toBe('Another simple expectation');
    });

    test('should handle mixed single-line and multiline expectations', () => {
      const markdown = `<!-- suite -->
# Test Suite

<!-- test
priority: high
-->
# Mixed Test

## Requirements
/test-page

## Expected
* Single line
* Multiline step
  With additional content
  And more content
* Another single line

<!-- test -->
`;

      writeFileSync(testFilePath, markdown, 'utf-8');
      const plan = Plan.fromMarkdown(testFilePath);

      expect(plan.tests[0].expected.length).toBe(3);
      expect(plan.tests[0].expected[0]).toBe('Single line');
      expect(plan.tests[0].expected[1]).toBe('Multiline step\n  With additional content\n  And more content');
      expect(plan.tests[0].expected[2]).toBe('Another single line');
    });
  });

  describe('saveToMarkdown', () => {
    test('should save multiline expectations with proper indentation', () => {
      const plan = new Plan('Test Suite');
      const test = new Test('Test Scenario', 'high', [], '/test-page');

      test.expected = ['Step title\n  Step multiline content\n  Additional line', 'Another expectation'];

      plan.addTest(test);
      plan.saveToMarkdown(testFilePath);

      const savedPlan = Plan.fromMarkdown(testFilePath);
      expect(savedPlan.tests[0].expected[0]).toBe('Step title\n  Step multiline content\n  Additional line');
      expect(savedPlan.tests[0].expected[1]).toBe('Another expectation');
    });

    test('should preserve table formatting in expectations', () => {
      const plan = new Plan('Test Suite');
      const test = new Test('Table Test', 'medium', [], '/test-page');

      test.expected = ['Verify table structure\n  | Column 1 | Column 2 |\n  | -------- | -------- |\n  | Data 1   | Data 2   |\n  *Expected*: Table should display correctly'];

      plan.addTest(test);
      plan.saveToMarkdown(testFilePath);

      const savedPlan = Plan.fromMarkdown(testFilePath);
      expect(savedPlan.tests[0].expected[0]).toContain('| Column 1 | Column 2 |');
      expect(savedPlan.tests[0].expected[0]).toContain('*Expected*: Table should display correctly');
    });

    test('should handle single-line expectations correctly', () => {
      const plan = new Plan('Test Suite');
      const test = new Test('Simple Test', 'low', ['Simple expectation', 'Another simple expectation'], '/test-page');

      plan.addTest(test);
      plan.saveToMarkdown(testFilePath);

      const savedPlan = Plan.fromMarkdown(testFilePath);
      expect(savedPlan.tests[0].expected[0]).toBe('Simple expectation');
      expect(savedPlan.tests[0].expected[1]).toBe('Another simple expectation');
    });
  });

  describe('roundtrip conversion', () => {
    test('should preserve multiline content through save and load', () => {
      const markdown = `<!-- suite -->
# Test Suite

<!-- test
priority: high
-->
# Roundtrip Test

## Requirements
/test-page

## Expected
* Step with image
  ![Alt text](image.png)
  *Expected*: Image loads
* Step with table
  | Col1 | Col2 |
  | ---- | ---- |
  | A    | B    |

<!-- test -->
`;

      writeFileSync(testFilePath, markdown, 'utf-8');
      const plan = Plan.fromMarkdown(testFilePath);

      const outputPath = join('/tmp', 'test-plan-output.md');
      plan.saveToMarkdown(outputPath);

      const reloadedPlan = Plan.fromMarkdown(outputPath);

      expect(reloadedPlan.tests[0].expected[0]).toContain('![Alt text](image.png)');
      expect(reloadedPlan.tests[0].expected[0]).toContain('*Expected*: Image loads');
      expect(reloadedPlan.tests[0].expected[1]).toContain('| Col1 | Col2 |');

      unlinkSync(outputPath);
    });
  });

  describe('planned steps', () => {
    test('should parse planned steps from markdown', () => {
      const markdown = `<!-- suite -->
# Test Suite

<!-- test
priority: high
-->
# Test with Steps

## Requirements
/test-page

## Steps
* Click on Login button
* Enter username in email field
* Submit the form

## Expected
* Success message is displayed
* URL changes to /dashboard

<!-- test -->
`;

      writeFileSync(testFilePath, markdown, 'utf-8');
      const plan = Plan.fromMarkdown(testFilePath);

      expect(plan.tests[0].plannedSteps.length).toBe(3);
      expect(plan.tests[0].plannedSteps[0]).toBe('Click on Login button');
      expect(plan.tests[0].plannedSteps[1]).toBe('Enter username in email field');
      expect(plan.tests[0].plannedSteps[2]).toBe('Submit the form');
    });

    test('should save planned steps to markdown', () => {
      const plan = new Plan('Test Suite');
      const test = new Test('Test with Steps', 'high', ['Success message is displayed', 'URL changes to /dashboard'], '/test-page', [
        'Click on Login button',
        'Enter username in email field',
        'Submit the form',
      ]);

      plan.addTest(test);
      plan.saveToMarkdown(testFilePath);

      const savedPlan = Plan.fromMarkdown(testFilePath);
      expect(savedPlan.tests[0].plannedSteps.length).toBe(3);
      expect(savedPlan.tests[0].plannedSteps[0]).toBe('Click on Login button');
      expect(savedPlan.tests[0].plannedSteps[1]).toBe('Enter username in email field');
      expect(savedPlan.tests[0].plannedSteps[2]).toBe('Submit the form');
    });

    test('should handle multiline steps', () => {
      const markdown = `<!-- suite -->
# Test Suite

<!-- test
priority: medium
-->
# Test with Multiline Steps

## Requirements
/test-page

## Steps
* Click on Login button
  Located in the top right corner
* Enter username
  Use test@example.com
* Submit the form

## Expected
* Success message appears

<!-- test -->
`;

      writeFileSync(testFilePath, markdown, 'utf-8');
      const plan = Plan.fromMarkdown(testFilePath);

      expect(plan.tests[0].plannedSteps.length).toBe(3);
      expect(plan.tests[0].plannedSteps[0]).toBe('Click on Login button\n  Located in the top right corner');
      expect(plan.tests[0].plannedSteps[1]).toBe('Enter username\n  Use test@example.com');
      expect(plan.tests[0].plannedSteps[2]).toBe('Submit the form');
    });

    test('should handle tests without steps', () => {
      const markdown = `<!-- suite -->
# Test Suite

<!-- test
priority: low
-->
# Test without Steps

## Requirements
/test-page

## Expected
* Page loads successfully

<!-- test -->
`;

      writeFileSync(testFilePath, markdown, 'utf-8');
      const plan = Plan.fromMarkdown(testFilePath);

      expect(plan.tests[0].plannedSteps.length).toBe(0);
      expect(plan.tests[0].expected.length).toBe(1);
    });

    test('should include planned steps in AI context', () => {
      const plan = new Plan('Test Suite');
      const test = new Test('Test Scenario', 'high', ['Success message is displayed'], '/test-page', ['Click button', 'Enter text']);

      plan.addTest(test);

      const context = plan.toAiContext();

      expect(context).toContain('**Planned Steps:**');
      expect(context).toContain('- Click button');
      expect(context).toContain('- Enter text');
    });
  });
});
