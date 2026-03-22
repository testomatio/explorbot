import { readFileSync, writeFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { dereference } from '@scalar/openapi-parser';
import { tag } from '../../../src/utils/logger.ts';

export function validateSpecs(specs?: string[]): void {
  if (!specs?.length) {
    throw new Error('API spec is required. Set api.spec in your config file.');
  }
}

export async function loadSpec(specPaths: string[], outputDir: string): Promise<any> {
  const contents: string[] = [];

  for (const specPath of specPaths) {
    if (specPath.startsWith('http://') || specPath.startsWith('https://')) {
      const response = await fetch(specPath);
      if (!response.ok) throw new Error(`Failed to fetch spec from ${specPath}: ${response.status}`);
      const content = await response.text();

      const specDir = path.join(outputDir, 'spec');
      mkdirSync(specDir, { recursive: true });
      const filename = specPath.split('/').pop() || 'spec.yaml';
      writeFileSync(path.join(specDir, filename), content, 'utf8');
      tag('info').log(`Spec downloaded: ${filename}`);

      contents.push(content);
    } else {
      contents.push(readFileSync(specPath, 'utf8'));
    }
  }

  const combined = contents[0];
  const result = dereference(combined);

  if (result.errors?.length) {
    tag('warning').log(`Spec parse warnings: ${result.errors.map((e) => e.message).join(', ')}`);
  }

  if (!result.schema) {
    throw new Error('Failed to parse OpenAPI spec');
  }

  return result.schema;
}

export function extractEndpointDefinition(schema: any, endpoint: string, baseEndpoint?: string): string {
  if (!schema?.paths) {
    throw new Error('OpenAPI spec has no paths defined');
  }

  const basePath = toBasePath(baseEndpoint);
  const matched = collectMatchingPaths(schema, basePath, (normalized) => matchesEndpoint(normalized, endpoint));

  if (!Object.keys(matched).length) {
    const available = listNormalizedPaths(schema, basePath);
    throw new Error(`Endpoint "${endpoint}" not found in spec. Available: ${available}`);
  }

  return safeStringify(matched);
}

export function searchEndpoints(schema: any, query: string, baseEndpoint?: string): string {
  if (!schema?.paths) return 'No endpoints available';

  const basePath = toBasePath(baseEndpoint);

  if (!query || query === '*') {
    const lines = Object.keys(schema.paths).map((p) => {
      const normalized = stripBasePath(p, basePath);
      const methods = Object.keys(schema.paths[p])
        .filter((m) => ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(m))
        .map((m) => m.toUpperCase())
        .join(',');
      return `${methods} ${normalized}`;
    });
    return lines.join('\n');
  }

  const lowerQuery = query.toLowerCase();
  const matched = collectMatchingPaths(schema, basePath, (normalized) => normalized.toLowerCase().includes(lowerQuery));

  if (!Object.keys(matched).length) {
    return `No endpoints matching "${query}". Available: ${listNormalizedPaths(schema, basePath)}`;
  }

  return safeStringify(matched);
}

function toBasePath(baseEndpoint?: string): string {
  return baseEndpoint ? new URL(baseEndpoint).pathname.replace(/\/$/, '') : '';
}

function collectMatchingPaths(schema: any, basePath: string, predicate: (normalized: string) => boolean): Record<string, any> {
  const matched: Record<string, any> = {};
  for (const specPath of Object.keys(schema.paths)) {
    const normalized = stripBasePath(specPath, basePath);
    if (!predicate(normalized)) continue;
    matched[specPath] = schema.paths[specPath];
  }
  return matched;
}

function listNormalizedPaths(schema: any, basePath: string): string {
  return Object.keys(schema.paths)
    .map((p) => stripBasePath(p, basePath))
    .join(', ');
}

function safeStringify(obj: any): string {
  const seen = new WeakSet();
  return JSON.stringify(
    obj,
    (_key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
      }
      return value;
    },
    2
  );
}

function stripBasePath(specPath: string, basePath: string): string {
  if (!basePath) return specPath;

  const specSegments = specPath.split('/').filter(Boolean);
  const baseSegments = basePath.split('/').filter(Boolean);

  let i = 0;
  while (i < baseSegments.length && i < specSegments.length) {
    const spec = specSegments[i];
    const base = baseSegments[i];
    if (spec === base || spec.startsWith('{')) {
      i++;
      continue;
    }
    break;
  }

  return '/' + specSegments.slice(i).join('/');
}

function matchesEndpoint(specPath: string, endpoint: string): boolean {
  if (specPath === endpoint) return true;
  if (specPath.startsWith(`${endpoint}/`)) return true;
  if (specPath.startsWith(`${endpoint}/{`)) return true;
  return false;
}
