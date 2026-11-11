import { describe, expect, it } from 'bun:test';
import { Pilot } from '../../src/ai/pilot.ts';

function buildPilot(): Pilot {
  const stateManager = { getStateHistory: () => [{ toState: { url: '/items' } }] };
  return Object.assign(Object.create(Pilot.prototype), { stateManager }) as Pilot;
}

function click(explanation: string, url: string, landedUrl?: string) {
  const output: any = { url };
  if (landedUrl) output.pageDiff = { currentUrl: landedUrl };
  return { toolName: 'click', wasSuccessful: true, input: { explanation }, output };
}

function see(request: string, analysis: string) {
  return { toolName: 'see', wasSuccessful: true, input: { request }, output: { analysis } };
}

describe('Pilot session log', () => {
  it('keeps a revisited page as a separate, later group', () => {
    const pilot = buildPilot();
    const conversation = {
      getToolExecutions: () => [click('Open edit form', '/items', '/items/edit/1'), see('Filters', 'Filter section is empty'), click('Save', '/items/edit/1', '/items/1'), click('Reopen edit form', '/items/1', '/items/edit/1'), see('Filters', 'Filter section shows one filter')],
    };

    const log: string = (pilot as any).formatSessionLog(conversation);
    const headers = log.split('\n').filter((line) => line.startsWith('/'));

    expect(headers).toEqual(['/items', '/items/edit/1', '/items/1', '/items/edit/1']);
    expect(log.indexOf('Filter section is empty')).toBeLessThan(log.indexOf('Reopen edit form'));
    expect(log.indexOf('Reopen edit form')).toBeLessThan(log.indexOf('Filter section shows one filter'));
  });

  it('files checks made after a navigation under the page they ran on', () => {
    const pilot = buildPilot();
    const conversation = {
      getToolExecutions: () => [click('Open edit form', '/items', '/items/edit/1'), see('Filters', 'Filter section is empty')],
    };

    const log: string = (pilot as any).formatSessionLog(conversation);

    expect(log.indexOf('\n/items/edit/1')).toBeGreaterThan(log.indexOf('Open edit form'));
    expect(log.indexOf('\n/items/edit/1')).toBeLessThan(log.indexOf('Filter section is empty'));
  });
});
