import { describe, expect, it } from 'bun:test';
import { extractEndpointDefinition, listAllEndpoints, resolveEndpoints } from '../../src/api/spec-reader.ts';

const schema = {
  paths: {
    '/api/v2/{project_id}/info': { get: { summary: 'Project info' } },
    '/api/v2/{project_id}/tests': { get: { summary: 'List tests' }, post: { summary: 'Create test' } },
    '/api/v2/{project_id}/tests/{id}': { get: { summary: 'Get test' } },
    '/api/v2/{project_id}/suites': { get: { summary: 'List suites' } },
    '/api/v2/{project_id}/suites/markdown_import': { post: { summary: 'Import markdown' } },
    '/api/v2/{project_id}/suites/{id}': { get: { summary: 'Get suite' } },
    '/api/v2/{project_id}/runs': { get: { summary: 'List runs' } },
    '/api/v2/{project_id}/runs/{id}/stats/{dimension}': { get: { summary: 'Run stats' } },
    '/api/v2/{project_id}/analytics/tests/{kind}': { get: { summary: 'Test analytics' } },
  },
};

const matchedPaths = (endpoint: string, baseEndpoint?: string) => Object.keys(JSON.parse(extractEndpointDefinition(schema, endpoint, baseEndpoint)));

describe('extractEndpointDefinition', () => {
  it('matches a real path against a templated spec path', () => {
    expect(matchedPaths('/api/v2/zyntra-don-t-touch-cloned/tests')).toEqual(['/api/v2/{project_id}/tests', '/api/v2/{project_id}/tests/{id}']);
  });

  it('matches a real path with every parameter filled in', () => {
    expect(matchedPaths('/api/v2/zyntra/tests/42')).toEqual(['/api/v2/{project_id}/tests/{id}']);
  });

  it('prefers a literal segment over a parameter', () => {
    expect(matchedPaths('/api/v2/zyntra/suites/markdown_import')).toEqual(['/api/v2/{project_id}/suites/markdown_import']);
  });

  it('still matches a templated path written out as is', () => {
    expect(matchedPaths('/api/v2/{project_id}/tests')).toEqual(['/api/v2/{project_id}/tests', '/api/v2/{project_id}/tests/{id}']);
  });

  it('strips the base endpoint path', () => {
    expect(matchedPaths('/zyntra/tests', 'https://beta.testomat.io/api/v2')).toEqual(['/api/v2/{project_id}/tests', '/api/v2/{project_id}/tests/{id}']);
  });

  it('throws when a segment is missing', () => {
    expect(() => matchedPaths('/api/v2/tests')).toThrow('not found in spec');
  });

  it('throws for an unknown endpoint', () => {
    expect(() => matchedPaths('/api/v2/zyntra/nope')).toThrow('not found in spec');
  });
});

describe('listAllEndpoints', () => {
  it('lists every method with its summary', () => {
    expect(listAllEndpoints(schema)).toContain('GET /api/v2/{project_id}/tests - List tests');
  });
});

describe('resolveEndpoints', () => {
  it('folds a wildcard leaf back into its collection', () => {
    expect(resolveEndpoints(schema, '/api/v2/zyntra/tests/*')).toEqual(['/api/v2/zyntra/tests']);
  });

  it('returns one endpoint per collection, in spec order', () => {
    expect(resolveEndpoints(schema, '/api/v2/zyntra/*')).toEqual(['/api/v2/zyntra/info', '/api/v2/zyntra/tests', '/api/v2/zyntra/suites', '/api/v2/zyntra/runs']);
  });

  it('folds a deep path into its collection over a gap in the spec', () => {
    expect(resolveEndpoints(schema, '/api/v2/zyntra/runs/*')).toEqual(['/api/v2/zyntra/runs']);
  });

  it('takes every collection when the base endpoint carries the parameters', () => {
    expect(resolveEndpoints(schema, '/', 'https://beta.testomat.io/api/v2/zyntra')).toEqual(['/info', '/tests', '/suites', '/runs']);
  });

  it('reports the parameter it cannot fill in', () => {
    expect(() => resolveEndpoints(schema, '/', 'https://beta.testomat.io')).toThrow('{project_id}');
  });

  it('returns a plain endpoint as it is', () => {
    expect(resolveEndpoints(schema, '/api/v2/zyntra/tests')).toEqual(['/api/v2/zyntra/tests']);
  });

  it('throws for an unknown endpoint', () => {
    expect(() => resolveEndpoints(schema, '/api/v2/zyntra/nope')).toThrow('not found in spec');
  });
});
