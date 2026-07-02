import { describe, expect, it } from 'bun:test';
import type { SessionStep } from '../../src/experience-tracker.ts';
import { getCodeceptToolNameFromCode, isCodeceptToolName, isNonReusableCode, mergeUniqueStepsByCode, stripComments, toReusableSessionStep } from '../../src/utils/step-analyzer.ts';

describe('step-analyzer', () => {
  it('maps CodeceptJS commands to agent tool names', () => {
    expect(getCodeceptToolNameFromCode('I.click("Save")')).toBe('click');
    expect(getCodeceptToolNameFromCode('I.hover(".menu")')).toBe('hover');
    expect(getCodeceptToolNameFromCode('I.pressKey("Enter")')).toBe('pressKey');
    expect(getCodeceptToolNameFromCode('I.fillField("Title", "Item")')).toBe('form');
    expect(getCodeceptToolNameFromCode('I.selectOption("Role", "Admin")')).toBe('form');
    expect(getCodeceptToolNameFromCode('I.see("Done")')).toBe(null);
  });

  it('recognizes CodeceptJS agent tools by name', () => {
    expect(isCodeceptToolName('click')).toBe(true);
    expect(isCodeceptToolName('form')).toBe(true);
    expect(isCodeceptToolName('verify')).toBe(false);
  });

  it('strips standalone comments from code blocks', () => {
    expect(stripComments('// setup\nI.click("Save")\n/* note */\n* skipped')).toBe('I.click("Save")');
  });

  it('flags non-reusable CodeceptJS code', () => {
    expect(isNonReusableCode('I.clickXY(100, 200)')).toBe(true);
    expect(isNonReusableCode("I.click('#ember42')")).toBe(true);
    expect(isNonReusableCode('I.click("Save", ".modal")')).toBe(false);
  });

  it('converts passed task steps into reusable session steps', () => {
    expect(toReusableSessionStep({ text: 'I.fillField("Title", "Item")', status: 'passed' })).toEqual({
      message: 'I.fillField("Title", "Item")',
      status: 'passed',
      tool: 'form',
      code: 'I.fillField("Title", "Item")',
    });
    expect(toReusableSessionStep({ text: 'I.fillField("Title", "Item")', status: 'failed' })).toBe(null);
    expect(toReusableSessionStep({ text: 'I.clickXY(1, 2)', status: 'passed' })).toBe(null);
  });

  it('merges steps by reusable code identity', () => {
    const primary: SessionStep[] = [{ message: 'first', status: 'passed', tool: 'click', code: 'I.click("Save")' }];
    const secondary: SessionStep[] = [
      { message: 'same', status: 'passed', tool: 'click', code: '// comment\nI.click("Save")' },
      { message: 'next', status: 'passed', tool: 'pressKey', code: 'I.pressKey("Enter")' },
    ];

    expect(mergeUniqueStepsByCode(primary, secondary)).toEqual([primary[0], secondary[1]]);
  });
});
