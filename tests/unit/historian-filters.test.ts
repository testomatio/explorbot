import { describe, expect, it } from 'bun:test';
import { isNonReusableCode } from '../../src/ai/historian';

describe('isNonReusableCode', () => {
  it('flags I.clickXY calls', () => {
    expect(isNonReusableCode('I.clickXY(100, 200)')).toBe(true);
    expect(isNonReusableCode('  I.clickXY( 50 , 80 );')).toBe(true);
    expect(isNonReusableCode('I.click("Submit")\nI.clickXY(10,20)')).toBe(true);
  });

  it('does not flag regular I.click calls', () => {
    expect(isNonReusableCode('I.click("Submit")')).toBe(false);
    expect(isNonReusableCode('I.clickLink("About")')).toBe(false);
    expect(isNonReusableCode('I.fillField("name", "x")')).toBe(false);
  });

  it('does not flag comments or strings that mention clickXY', () => {
    // substring check is word-boundary based; still, inline strings would match — acceptable trade-off
    expect(isNonReusableCode('// no clickXY here')).toBe(false);
    expect(isNonReusableCode('I.say("clickXY is bad")')).toBe(false);
  });
});
