import { readFileSync, writeFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { dereference } from '@scalar/openapi-parser';
import { tag } from '../utils/logger.ts';

export function validateSpecs(specs?: string[]): void {
  if (!specs?.length) {
    throw new Error('API spec is required. Pass --spec, set EXPLORBOT_API_SPEC, or set api.spec in your config file.');
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
  const matched = collectEndpointPaths(schema, basePath, endpoint);

  if (!Object.keys(matched).length) {
    const available = listNormalizedPaths(schema, basePath);
    throw new Error(`Endpoint "${endpoint}" not found in spec. Available: ${available}`);
  }

  return safeStringify(matched);
}

export function resolveEndpoints(schema: any, pattern: string, baseEndpoint?: string): string[] {
  if (!schema?.paths) {
    throw new Error('OpenAPI spec has no paths defined');
  }

  const basePath = toBasePath(baseEndpoint);
  const normalized = Object.keys(schema.paths).map((specPath) => stripBasePath(specPath, basePath));
  const matched = normalized.filter((specPath) => matchesPattern(specPath, pattern));

  if (!matched.length) {
    throw new Error(`Endpoint "${pattern}" not found in spec. Available: ${listNormalizedPaths(schema, basePath)}`);
  }

  const roots = matched.map((specPath) => toCollection(specPath, normalized, pattern));
  const resolved = [...new Set(roots.map((root) => fillParameters(root, pattern)))];
  const endpoints = resolved.filter((specPath) => !specPath.includes('{'));

  if (!endpoints.length) {
    throw new Error(`Endpoint "${pattern}" leaves ${listParameters(resolved)} unresolved. Give the value in the endpoint or in the base endpoint.`);
  }

  const skipped = resolved.filter((specPath) => specPath.includes('{'));
  if (skipped.length) {
    tag('warning').log(`Skipped, no value for their parameters: ${skipped.join(', ')}`);
  }

  return endpoints;
}

export function searchEndpoints(schema: any, query: string, baseEndpoint?: string): string {
  if (!schema?.paths) return 'No endpoints available';

  const basePath = toBasePath(baseEndpoint);

  if (!query || query === '*') {
    const lines = Object.keys(schema.paths).map((p) => {
      const normalized = stripBasePath(p, basePath);
      const methods = Object.keys(schema.paths[p])
        .filter((m) => HTTP_METHODS.includes(m))
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

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

export function listAllEndpoints(schema: any, baseEndpoint?: string): string {
  if (!schema?.paths) return '';

  const basePath = toBasePath(baseEndpoint);
  const lines: string[] = [];

  for (const specPath of Object.keys(schema.paths)) {
    const normalized = stripBasePath(specPath, basePath);
    const pathDef = schema.paths[specPath];

    for (const method of HTTP_METHODS) {
      if (!pathDef[method]) continue;
      const summary = pathDef[method].summary || pathDef[method].description || '';
      const desc = summary ? ` - ${summary}` : '';
      lines.push(`${method.toUpperCase()} ${normalized}${desc}`);
    }
  }

  return lines.join('\n');
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

  return `/${specSegments.slice(i).join('/')}`;
}

function collectEndpointPaths(schema: any, basePath: string, endpoint: string): Record<string, any> {
  const normalized = Object.keys(schema.paths).map((specPath) => stripBasePath(specPath, basePath));
  const roots = resolveEndpoint(normalized, endpoint);

  if (!roots.length) return collectMatchingPaths(schema, basePath, (path) => matchesEndpoint(path, endpoint));

  return collectMatchingPaths(schema, basePath, (path) => roots.some((root) => path === root || path.startsWith(`${root}/`)));
}

function resolveEndpoint(specPaths: string[], endpoint: string): string[] {
  const wanted = toSegments(endpoint);
  if (!wanted.length) return [];

  const matched = specPaths.filter((specPath) => {
    const segments = toSegments(specPath);
    if (segments.length !== wanted.length) return false;
    return segmentsMatch(segments, wanted);
  });

  const literals = matched.map((specPath) => toSegments(specPath).filter((segment, i) => segment === wanted[i]).length);
  const best = Math.max(0, ...literals);
  return matched.filter((_, i) => literals[i] === best);
}

function matchesPattern(specPath: string, pattern: string): boolean {
  const wanted = toSegments(pattern);
  const segments = toSegments(specPath);
  if (segments.length < wanted.length) return false;
  return segmentsMatch(segments, wanted);
}

function segmentsMatch(segments: string[], wanted: string[]): boolean {
  return wanted.every((want, i) => want === '*' || segments[i] === want || segments[i].startsWith('{'));
}

function toCollection(specPath: string, specPaths: string[], pattern: string): string {
  const segments = toSegments(specPath);
  const filled = toSegments(fillParameters(specPath, pattern));

  let deepest = segments.length;
  const unfilled = filled.findIndex((segment) => segment.startsWith('{'));
  if (unfilled >= 0) deepest = unfilled;

  for (let i = Math.max(1, Math.min(toSegments(pattern).length, deepest)); i <= deepest; i++) {
    const prefix = `/${segments.slice(0, i).join('/')}`;
    if (specPaths.includes(prefix)) return prefix;
  }

  return specPath;
}

function fillParameters(specPath: string, pattern: string): string {
  const wanted = toSegments(pattern);
  const segments = toSegments(specPath);
  for (let i = 0; i < wanted.length && i < segments.length; i++) {
    if (wanted[i] === '*') continue;
    if (!segments[i].startsWith('{')) continue;
    segments[i] = wanted[i];
  }
  return `/${segments.join('/')}`;
}

function listParameters(specPaths: string[]): string {
  const found = new Set<string>();
  for (const specPath of specPaths) {
    for (const segment of toSegments(specPath)) {
      if (segment.startsWith('{')) found.add(segment);
    }
  }
  return [...found].join(', ');
}

function toSegments(path: string): string[] {
  return path.split('/').filter(Boolean);
}

function matchesEndpoint(specPath: string, endpoint: string): boolean {
  if (specPath === endpoint) return true;
  if (specPath.startsWith(`${endpoint}/`)) return true;
  if (specPath.startsWith(`${endpoint}/{`)) return true;
  return false;
}
