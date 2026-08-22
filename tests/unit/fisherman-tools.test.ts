import { describe, expect, it } from 'bun:test';
import { createFishermanTools } from '../../src/ai/fisherman-tools.ts';

describe('Fisherman tools', () => {
  it('does not present a rejected capture as a request example', async () => {
    const captured = { method: 'POST', path: '/plans', status: 400, requestBody: { plan: 'wrong' } };
    const { tools } = createFishermanTools({} as any, store(captured), {});

    const result: any = await tools.getEndpointSpec.execute({ method: 'POST', path: '/plans' }, {} as any);

    expect(result.usable).toBe(false);
    expect(result.rejectedRequestBody).toEqual({ plan: 'wrong' });
    expect(result.requestBody).toBeUndefined();
  });

  it('prefers the specification when the captured request was rejected', async () => {
    const captured = { method: 'POST', path: '/plans', status: 422, requestBody: { plan: 'wrong' } };
    const spec = { paths: { '/plans': { post: { requestBody: { required: true } } } } };
    const { tools } = createFishermanTools({} as any, store(captured), { spec });

    const result: any = await tools.getEndpointSpec.execute({ method: 'POST', path: '/plans' }, {} as any);

    expect(result.source).toBe('spec');
    expect(result.definition).toContain('requestBody');
    expect(result.rejectedCapture.status).toBe(422);
  });

  it('keeps a successful captured request as a usable example', async () => {
    const captured = { method: 'POST', path: '/plans', status: 201, requestBody: { title: 'Plan' } };
    const { tools } = createFishermanTools({} as any, store(captured), {});

    const result: any = await tools.getEndpointSpec.execute({ method: 'POST', path: '/plans' }, {} as any);

    expect(result.source).toBe('captured');
    expect(result.requestBody).toEqual({ title: 'Plan' });
    expect(result.usable).not.toBe(false);
  });

  it('classifies failures by HTTP semantics', async () => {
    for (const [status, category] of [
      [422, 'validation'],
      [401, 'authorization'],
      [404, 'not_found'],
      [409, 'conflict'],
      [429, 'temporary'],
      [503, 'server'],
    ] as const) {
      const apiClient = {
        request: async () => ({ status, statusText: String(status), rawResponseBody: '{}', responseBody: null }),
      };
      const { tools } = createFishermanTools(apiClient as any, store(), {});

      const result: any = await tools.request.execute({ method: 'POST', path: '/plans' }, {} as any);

      expect(result.category).toBe(category);
    }
  });
});

function store(captured?: any): any {
  return {
    findCapturedRequest: () => captured,
    addMadeRequest: () => {},
  };
}
