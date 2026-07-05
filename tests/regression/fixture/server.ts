import { handleApi } from './api.ts';
import { type Variant, type VariantMode, createRegistry } from './components.ts';
import { activityWidget, issueDetailPage, issuesPage, loginPage, newIssuePage, settingsPage, vaultPage } from './pages.ts';
import { type Store, createStore } from './store.ts';

export const VAULT_CODE = 'K7-9284-XRAY-TANGO';
const VAULT_DOCS = ['Quarterly report', 'Design archive', 'Payroll ledger'];
const PUBLIC_PATHS = ['/login', '/logout', '/vault', '/vault/unlock', '/assets/client.js'];

const CLIENT_JS = await Bun.file(`${import.meta.dir}/client.js`).text();

export function startFixture(opts: { port?: number; variant?: VariantMode; seed?: number } = {}): Fixture {
  const variant = opts.variant || 'native';
  const seed = opts.seed || 42;
  const store = createStore();
  const server = Bun.serve({
    port: opts.port || 0,
    idleTimeout: 60,
    fetch: (req) => handle(req, store, variant, seed),
  });
  return {
    url: `http://localhost:${server.port}`,
    port: server.port,
    stop: () => server.stop(true),
  };
}

async function handle(req: Request, store: Store, defaultVariant: VariantMode, defaultSeed: number): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;
  const cookies = parseCookies(req.headers.get('cookie'));

  if (path === '/assets/client.js') {
    return new Response(CLIENT_JS, { headers: { 'content-type': 'application/javascript' } });
  }

  const variantOverride = url.searchParams.get('variant');
  if (variantOverride) {
    const seedParam = url.searchParams.get('seed') || String(defaultSeed);
    const headers = new Headers();
    headers.append('set-cookie', `trackly_variant=${variantOverride}; Path=/`);
    headers.append('set-cookie', `trackly_seed=${seedParam}; Path=/`);
    headers.set('location', path);
    return new Response(null, { status: 302, headers });
  }

  const variant = (cookies.trackly_variant as VariantMode) || defaultVariant;
  const seed = Number(cookies.trackly_seed) || defaultSeed;
  const reg = createRegistry({ mode: variant, seed });
  const user = store.userForToken(cookies.trackly_session || null);

  const apiResponse = await handleApi(req, url, store, user);
  if (apiResponse) return apiResponse;

  if (path === '/login' && method === 'GET') return html(loginPage());
  if (path === '/login' && method === 'POST') {
    const form = await req.formData();
    const token = store.login(String(form.get('email') || ''), String(form.get('password') || ''));
    if (!token) return html(loginPage('Invalid email or password'), 401);
    return redirect('/issues', `trackly_session=${token}; Path=/; HttpOnly`);
  }
  if (path === '/logout') return redirect('/login', 'trackly_session=; Path=/; Max-Age=0');

  if (path === '/vault' && method === 'GET') return html(vaultPage({}));
  if (path === '/vault/unlock' && method === 'POST') {
    const form = await req.formData();
    if (String(form.get('code') || '') === VAULT_CODE) return html(vaultPage({ unlocked: true, docs: VAULT_DOCS }));
    return html(vaultPage({ error: true }));
  }
  if (path.startsWith('/vault')) return redirect('/vault');

  if (!user) return redirect('/login');

  if (path === '/') return redirect('/issues');

  if (path === '/issues' && method === 'GET') {
    const filters = { q: url.searchParams.get('q') || undefined, status: url.searchParams.get('status') || undefined, label: url.searchParams.get('label') || undefined };
    return html(issuesPage(reg, store, filters, user));
  }

  if (path === '/issues/new' && method === 'GET') return html(newIssuePage(reg, store, user));
  if (path === '/issues/new' && method === 'POST') {
    const form = await req.formData();
    const result = store.createIssue({
      title: String(form.get('title') || ''),
      description: String(form.get('description') || ''),
      priority: form.get('priority') as never,
      labels: form.getAll('labels').map(String),
      assignees: form.getAll('assignees').map(String),
    });
    if (result.error) return html(newIssuePage(reg, store, user, result.error), 422);
    return redirect(`/issues/${result.issue?.id}`);
  }

  const statusMatch = path.match(/^\/issues\/(\d+)\/status\/(\w+)$/);
  if (statusMatch && method === 'POST') {
    store.updateIssue(Number(statusMatch[1]), { status: statusMatch[2] as never });
    return redirect(`/issues/${statusMatch[1]}`);
  }

  const editMatch = path.match(/^\/issues\/(\d+)\/edit$/);
  if (editMatch && method === 'POST') {
    const form = await req.formData();
    store.updateIssue(Number(editMatch[1]), {
      title: String(form.get('title') || ''),
      description: String(form.get('description') || ''),
      priority: form.get('priority') as never,
    });
    return redirect(`/issues/${editMatch[1]}`);
  }

  const commentMatch = path.match(/^\/issues\/(\d+)\/comments$/);
  if (commentMatch && method === 'POST') {
    const form = await req.formData();
    store.addComment(Number(commentMatch[1]), user.name, String(form.get('text') || ''));
    return redirect(`/issues/${commentMatch[1]}`);
  }

  const deleteMatch = path.match(/^\/issues\/(\d+)\/delete$/);
  if (deleteMatch && method === 'POST') {
    store.deleteIssue(Number(deleteMatch[1]));
    return redirect('/issues');
  }

  const detailMatch = path.match(/^\/issues\/(\d+)$/);
  if (detailMatch && method === 'GET') {
    const issue = store.getIssue(Number(detailMatch[1]));
    if (!issue) return html('<h1>Issue not found</h1>', 404);
    return html(issueDetailPage(reg, store, issue, user));
  }

  if (path === '/settings' && method === 'GET') {
    const saved = url.searchParams.get('saved') === '1';
    return html(settingsPage(reg, store, user, url.searchParams.get('tab') || 'profile', saved));
  }
  if (path === '/settings' && method === 'POST') {
    const form = await req.formData();
    return redirect(`/settings?tab=${form.get('tab') || 'profile'}&saved=1`);
  }

  if (path === '/widget/activity') return html(activityWidget(store));

  return html('<h1>Not found</h1>', 404);
}

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

function redirect(location: string, cookie?: string): Response {
  const headers = new Headers({ location });
  if (cookie) headers.set('set-cookie', cookie);
  return new Response(null, { status: 302, headers });
}

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key) out[key] = rest.join('=');
  }
  return out;
}

if (import.meta.main) {
  const fixture = startFixture({ port: Number(process.env.PORT) || 8899, variant: (process.env.VARIANT as Variant) || 'native', seed: Number(process.env.SEED) || 42 });
  console.log(`Trackly fixture running at ${fixture.url} (variant=${process.env.VARIANT || 'native'})`);
}

interface Fixture {
  url: string;
  port: number;
  stop: () => void;
}
