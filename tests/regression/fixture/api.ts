import type { PublicUser, Store } from './store.ts';

export async function handleApi(req: Request, url: URL, store: Store, user: PublicUser | null): Promise<Response | null> {
  const path = url.pathname;
  if (!path.startsWith('/api/')) return null;

  if (path === '/api/openapi.json') return json(openApiDoc(url.origin), 200);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const method = req.method;

  if (path === '/api/issues' && method === 'GET') {
    const filter = { status: url.searchParams.get('status') || undefined, label: url.searchParams.get('label') || undefined, q: url.searchParams.get('q') || undefined };
    return json(store.listIssues(filter), 200);
  }

  if (path === '/api/issues' && method === 'POST') {
    const body = await readJson(req);
    const result = store.createIssue(body);
    if (result.error) return json({ error: result.error }, 422);
    return json(result.issue, 201);
  }

  const issueMatch = path.match(/^\/api\/issues\/(\d+)$/);
  if (issueMatch) {
    const id = Number(issueMatch[1]);
    if (method === 'GET') {
      const issue = store.getIssue(id);
      if (!issue) return json({ error: 'not found' }, 404);
      return json(issue, 200);
    }
    if (method === 'PATCH') {
      const body = await readJson(req);
      const updated = store.updateIssue(id, body);
      if (!updated) return json({ error: 'not found' }, 404);
      return json(updated, 200);
    }
    if (method === 'DELETE') {
      const ok = store.deleteIssue(id);
      if (!ok) return json({ error: 'not found' }, 404);
      return new Response(null, { status: 204 });
    }
  }

  const commentMatch = path.match(/^\/api\/issues\/(\d+)\/comments$/);
  if (commentMatch && method === 'POST') {
    const id = Number(commentMatch[1]);
    const body = await readJson(req);
    const result = store.addComment(id, user.name, body.text);
    if (result.error) return json({ error: result.error }, 422);
    return json(result.comment, 201);
  }

  if (path === '/api/labels' && method === 'GET') return json(store.listLabels(), 200);
  if (path === '/api/users' && method === 'GET') return json(store.listUsers(), 200);

  return json({ error: 'not found' }, 404);
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  const body = await req.json().catch(() => ({}));
  return body as Record<string, unknown>;
}

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

function openApiDoc(origin: string): object {
  return {
    openapi: '3.0.0',
    info: { title: 'Trackly API', version: '1.0.0' },
    servers: [{ url: `${origin}/api` }],
    paths: {
      '/issues': {
        get: {
          summary: 'List issues',
          parameters: [
            { name: 'status', in: 'query', schema: { type: 'string' } },
            { name: 'label', in: 'query', schema: { type: 'string' } },
            { name: 'q', in: 'query', schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'issue list' } },
        },
        post: { summary: 'Create issue', requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/IssueInput' } } } }, responses: { '201': { description: 'created' }, '422': { description: 'invalid' } } },
      },
      '/issues/{id}': {
        get: { summary: 'Get issue', parameters: [idParam()], responses: { '200': { description: 'issue' }, '404': { description: 'not found' } } },
        patch: { summary: 'Update issue', parameters: [idParam()], responses: { '200': { description: 'updated' } } },
        delete: { summary: 'Delete issue', parameters: [idParam()], responses: { '204': { description: 'deleted' } } },
      },
      '/issues/{id}/comments': { post: { summary: 'Add comment', parameters: [idParam()], responses: { '201': { description: 'created' } } } },
      '/labels': { get: { summary: 'List labels', responses: { '200': { description: 'labels' } } } },
      '/users': { get: { summary: 'List users', responses: { '200': { description: 'users' } } } },
    },
    components: {
      schemas: {
        IssueInput: {
          type: 'object',
          required: ['title'],
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            priority: { type: 'string', enum: ['low', 'normal', 'high', 'critical'] },
            labels: { type: 'array', items: { type: 'integer' } },
            assignees: { type: 'array', items: { type: 'integer' } },
          },
        },
      },
    },
  };
}

function idParam(): object {
  return { name: 'id', in: 'path', required: true, schema: { type: 'integer' } };
}
