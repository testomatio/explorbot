import { describe, expect, it } from 'bun:test';
import type { ApiBot } from '../../boat/api-tester/src/apibot.ts';
import { ExploreCommand } from '../../boat/api-tester/src/commands/explore-command.ts';
import { Plan, Test } from '../../src/test-plan.ts';

interface Planned {
  endpoint: string;
  style: string;
}

function fakeBot(endpoints: string[], planned: Planned[], results: boolean[] = [true]): ApiBot {
  let attempt = 0;
  return {
    expandEndpoints: () => endpoints,
    plan: async (endpoint: string, opts: { style: string }) => {
      planned.push({ endpoint, style: opts.style });
      const plan = new Plan(`Plan for ${endpoint}`);
      plan.url = endpoint;
      plan.addTest(new Test(`check ${endpoint}`, 'normal', ['200 OK'], endpoint, []));
      return plan;
    },
    agentCurler: () => ({
      test: async () => {
        const success = results[attempt % results.length];
        attempt++;
        return { success };
      },
    }),
    tryGetEndpointDefinition: () => undefined,
    searchSpec: () => '',
    savePlan: () => null,
    getConfig: () => ({ api: { baseEndpoint: 'https://api.example.com' } }),
  } as unknown as ApiBot;
}

describe('ExploreCommand', () => {
  it('plans one endpoint in every style', async () => {
    const planned: Planned[] = [];
    await new ExploreCommand(fakeBot(['/users'], planned)).execute('/users');

    expect(planned).toEqual([
      { endpoint: '/users', style: 'normal' },
      { endpoint: '/users', style: 'curious' },
      { endpoint: '/users', style: 'psycho' },
      { endpoint: '/users', style: 'hacker' },
    ]);
  });

  it('gives each endpoint one style, wrapping around', async () => {
    const planned: Planned[] = [];
    const endpoints = ['/a', '/b', '/c', '/d', '/e'];
    await new ExploreCommand(fakeBot(endpoints, planned)).execute('/*');

    expect(planned).toEqual([
      { endpoint: '/a', style: 'normal' },
      { endpoint: '/b', style: 'curious' },
      { endpoint: '/c', style: 'psycho' },
      { endpoint: '/d', style: 'hacker' },
      { endpoint: '/e', style: 'normal' },
    ]);
  });

  it('counts every test it ran', async () => {
    const result = await new ExploreCommand(fakeBot(['/a', '/b'], [], [true, false])).execute('/*');

    expect(result).toEqual({ tests: 2, passed: 1, failed: 1 });
  });
});
