import type { Registry } from './components.ts';
import type { Issue, PublicUser, Store } from './store.ts';

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'closed', label: 'Closed' },
];

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

export function loginPage(error?: string): string {
  const alert = error ? `<p role="alert" class="alert">${esc(error)}</p>` : '';
  const body = `
    <main class="auth">
      <h1>Trackly</h1>
      <p>Sign in to manage issues.</p>
      ${alert}
      <form method="post" action="/login">
        <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" required></div>
        <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" required></div>
        <button type="submit">Sign in</button>
      </form>
    </main>`;
  return doc('Sign in · Trackly', body, null, 'login');
}

export function issuesPage(reg: Registry, store: Store, filters: { q?: string; status?: string; label?: string }, user: PublicUser, opts: { openDrawer?: boolean; error?: string } = {}): string {
  const labels = store.listLabels();
  const users = store.listUsers();
  const issues = store.listIssues(filters);
  const labelItems = [{ label: 'All labels', href: '/issues' }, ...labels.map((l) => ({ label: l.name, href: `/issues?label=${l.id}` }))];

  const filterForm = `
    <form method="get" action="/issues" class="filters">
      ${reg.textField({ label: 'Search issues', name: 'q', value: filters.q })}
      ${reg.select({ label: 'Status', name: 'status', options: [{ value: '', label: 'Any status' }, ...STATUS_OPTIONS], selected: filters.status })}
      ${reg.button({ label: 'Apply filters', submit: true })}
    </form>
    ${reg.dropdownMenu({ label: 'Filter by label', items: labelItems })}`;

  const rows = issues.map((issue) => issueRow(issue, labels, users)).join('');
  const table = `
    <table>
      <thead><tr><th>#</th><th>Title</th><th>Status</th><th>Priority</th><th>Labels</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  let empty = '';
  if (issues.length === 0) empty = '<p class="empty">No issues match your filter</p>';

  let drawer = '';
  if (opts.openDrawer) {
    let alert = '';
    if (opts.error) alert = `<p role="alert" class="alert">${esc(opts.error)}</p>`;
    drawer = `
    <dialog open id="new-issue-drawer" class="drawer" aria-label="New Issue">
      <h2>New Issue</h2>
      <p>Create an issue and assign labels and people.</p>
      ${alert}
      <form method="post" action="/issues/new">
        ${reg.textField({ label: 'Title', name: 'title', required: true })}
        ${reg.textArea({ label: 'Description', name: 'description' })}
        ${reg.select({ label: 'Priority', name: 'priority', options: PRIORITY_OPTIONS, selected: 'normal' })}
        ${reg.multiselect({ label: 'Labels', name: 'labels', options: labels.map((l) => ({ value: String(l.id), label: l.name })) })}
        ${reg.multiselect({ label: 'Assignees', name: 'assignees', options: users.map((u) => ({ value: String(u.id), label: u.name })) })}
        <div class="actions">
          ${reg.button({ label: 'Create Issue', submit: true })}
          <a href="/issues" role="button">Cancel</a>
        </div>
      </form>
    </dialog>`;
  }

  const body = `
    <h1>Issues</h1>
    <p>${issues.length} issue(s) shown.</p>
    <div class="toolbar"><a class="primary" href="/issues?new=1" role="button">New Issue</a></div>
    ${filterForm}
    ${table}
    ${empty}
    ${drawer}`;
  return doc('Issues · Trackly', body, user, 'issues');
}

export function issueDetailPage(reg: Registry, store: Store, issue: Issue, user: PublicUser): string {
  const labels = store.listLabels();
  const users = store.listUsers();
  const comments = store.listComments(issue.id);
  const labelNames = issue.labels
    .map((id) => labels.find((l) => l.id === id)?.name)
    .filter(Boolean)
    .join(', ');
  const assigneeNames = issue.assignees
    .map((id) => users.find((u) => u.id === id)?.name)
    .filter(Boolean)
    .join(', ');

  const statusItems = STATUS_OPTIONS.map((s) => ({ label: `Mark ${s.label}`, action: `/issues/${issue.id}/status/${s.value}` }));
  const commentList = comments.map((c) => `<li><strong>${esc(c.author)}:</strong> ${esc(c.text)}</li>`).join('');

  const body = `
    <h1>${esc(issue.title)}</h1>
    <p class="meta">Status: <span class="status">${esc(issue.status)}</span> · Priority: <span class="priority">${esc(issue.priority)}</span></p>
    <p>${esc(issue.description)}</p>
    <dl>
      <dt>Labels</dt><dd>${esc(labelNames || 'none')}</dd>
      <dt>Assignees</dt><dd>${esc(assigneeNames || 'none')}</dd>
    </dl>
    <div class="toolbar">
      ${reg.dropdownMenu({ label: 'Change status', items: statusItems })}
      ${reg.modal({ id: 'delete-issue', triggerLabel: 'Delete', title: 'Delete issue', body: 'This permanently removes the issue.', confirmLabel: 'Confirm delete', confirmAction: `/issues/${issue.id}/delete`, danger: true })}
    </div>
    <section>
      <h2>Edit issue</h2>
      <form method="post" action="/issues/${issue.id}/edit">
        ${reg.textField({ label: 'Title', name: 'title', value: issue.title, required: true })}
        ${reg.textArea({ label: 'Description', name: 'description', value: issue.description })}
        ${reg.select({ label: 'Priority', name: 'priority', options: PRIORITY_OPTIONS, selected: issue.priority })}
        ${reg.button({ label: 'Save changes', submit: true })}
      </form>
    </section>
    <section>
      <h2>Comments</h2>
      <ul class="comments">${commentList || '<li class="empty">No comments yet</li>'}</ul>
      <form method="post" action="/issues/${issue.id}/comments">
        ${reg.textArea({ label: 'Add a comment', name: 'text' })}
        ${reg.button({ label: 'Post comment', submit: true })}
      </form>
    </section>
    <p><a href="/issues">Back to issues</a></p>`;
  return doc(`${issue.title} · Trackly`, body, user, 'issues');
}

export function settingsPage(reg: Registry, store: Store, user: PublicUser, activeTab: string, saved?: boolean): string {
  const notice = saved ? '<p role="status" class="notice">Settings saved</p>' : '';
  const profile = `
    ${notice}
    <form method="post" action="/settings">
      <input type="hidden" name="tab" value="profile">
      ${reg.textField({ label: 'Name', name: 'name', value: user.name })}
      ${reg.textField({ label: 'Email', name: 'email', type: 'email', value: user.email })}
      ${reg.button({ label: 'Save profile', submit: true })}
    </form>`;
  const preferences = `
    <form method="post" action="/settings">
      <input type="hidden" name="tab" value="preferences">
      ${reg.select({
        label: 'Theme',
        name: 'theme',
        options: [
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
        ],
        selected: 'light',
      })}
      ${reg.multiselect({
        label: 'Email notifications',
        name: 'notify',
        options: [
          { value: 'mentions', label: 'Mentions' },
          { value: 'assignments', label: 'Assignments' },
          { value: 'comments', label: 'Comments' },
        ],
      })}
      ${reg.button({ label: 'Save preferences', submit: true })}
    </form>`;
  const tabs = reg.tabs({
    id: 'settings-tabs',
    active: activeTab,
    tabs: [
      { key: 'profile', label: 'Profile', content: profile },
      { key: 'preferences', label: 'Preferences', content: preferences },
    ],
  });
  const body = `
    <h1>Settings</h1>
    ${tabs}
    <section>
      <h2>Recent activity</h2>
      <iframe src="/widget/activity" title="Recent activity" width="100%" height="180"></iframe>
    </section>`;
  return doc('Settings · Trackly', body, user, 'settings');
}

export function activityWidget(store: Store): string {
  const items = store
    .recentActivity()
    .map((a) => `<li>${esc(a)}</li>`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Recent activity</title></head><body><h3>Recent activity</h3><ul>${items}</ul></body></html>`;
}

export function vaultPage(state: { error?: boolean; unlocked?: boolean; docs?: string[] }): string {
  if (state.unlocked) {
    const items = (state.docs || []).map((d) => `<li>${esc(d)}</li>`).join('');
    const body = `
      <main class="auth">
        <h1>Trackly Archive</h1>
        <h2>Vault unlocked</h2>
        <p>${(state.docs || []).length} secret documents available</p>
        <ul aria-label="Secret documents">${items}</ul>
      </main>`;
    return doc('Archive · Trackly', body, null, 'vault');
  }
  const alert = state.error ? '<p role="alert" class="alert">Invalid access code</p>' : '';
  const body = `
    <main class="auth">
      <h1>Trackly Archive</h1>
      <p>This vault is locked. Enter the access code to view archived documents.</p>
      ${alert}
      <form method="post" action="/vault/unlock">
        <div class="field"><label for="code">Access code</label><input id="code" name="code" type="text" required></div>
        <button type="submit">Unlock</button>
      </form>
    </main>`;
  return doc('Archive · Trackly', body, null, 'vault');
}

function issueRow(issue: Issue, labels: { id: number; name: string }[], users: { id: number; name: string }[]): string {
  const labelNames = issue.labels
    .map((id) => labels.find((l) => l.id === id)?.name)
    .filter(Boolean)
    .join(', ');
  return `<tr>
    <td>${issue.id}</td>
    <td><a href="/issues/${issue.id}">${esc(issue.title)}</a></td>
    <td>${esc(issue.status)}</td>
    <td>${esc(issue.priority)}</td>
    <td>${esc(labelNames)}</td>
  </tr>`;
}

function nav(user: PublicUser | null, active: string): string {
  if (!user) return '';
  const link = (href: string, label: string, key: string) => `<a href="${href}"${active === key ? ' aria-current="page"' : ''}>${label}</a>`;
  return `<header class="topnav">
    <strong>Trackly</strong>
    <nav>
      ${link('/issues', 'Issues', 'issues')}
      ${link('/issues?new=1', 'New Issue', 'new')}
      ${link('/settings', 'Settings', 'settings')}
      <a href="/logout">Logout</a>
    </nav>
    <span class="who">${esc(user.name)}</span>
  </header>`;
}

function doc(title: string, body: string, user: PublicUser | null, active: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <style>${STYLES}</style>
</head>
<body>
  ${nav(user, active)}
  <div class="container">${body}</div>
  <script src="/assets/client.js"></script>
</body>
</html>`;
}

function esc(value: string): string {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const STYLES = `
  * { box-sizing: border-box; }
  body { font-family: system-ui, sans-serif; margin: 0; color: #1a1a1a; background: #f6f8fa; }
  .topnav { display: flex; align-items: center; gap: 1rem; padding: .75rem 1.5rem; background: #24292f; color: #fff; }
  .topnav nav { display: flex; gap: 1rem; flex: 1; }
  .topnav a { color: #fff; text-decoration: none; }
  .topnav .who { opacity: .8; font-size: .9rem; }
  .container { max-width: 860px; margin: 1.5rem auto; padding: 0 1.5rem; }
  .auth { max-width: 380px; margin: 4rem auto; background: #fff; padding: 2rem; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.1); }
  .field { margin: .6rem 0; display: flex; flex-direction: column; gap: .25rem; }
  input, textarea, select { padding: .5rem; border: 1px solid #ccc; border-radius: 6px; font: inherit; }
  select[multiple] { min-height: 5rem; padding: .25rem; }
  button, .ui-btn, a[role=button], [role=button] { display: inline-block; padding: .5rem .9rem; border: 1px solid #d0d7de; border-radius: 6px; background: #f6f8fa; cursor: pointer; text-decoration: none; color: #1a1a1a; }
  button[type=submit], .primary { background: #1f883d; color: #fff; border-color: #1f883d; }
  [data-danger] { background: #cf222e; color: #fff; border-color: #cf222e; }
  table { width: 100%; border-collapse: collapse; margin-top: 1rem; background: #fff; }
  th, td { text-align: left; padding: .5rem .6rem; border-bottom: 1px solid #eaecef; }
  .toolbar, .actions { display: flex; gap: .75rem; align-items: center; margin: 1rem 0; }
  .filters { display: flex; gap: .75rem; align-items: flex-end; flex-wrap: wrap; margin: 1rem 0; }
  .alert { color: #cf222e; font-weight: 600; }
  .notice, .empty { color: #57606a; }
  .chips { display: flex; gap: .35rem; flex-wrap: wrap; }
  .chip { background: #ddf4ff; padding: .1rem .5rem; border-radius: 10px; font-size: .85rem; }
  .menu { border: 1px solid #d0d7de; border-radius: 6px; background: #fff; padding: .25rem; }
  .menu [role=option], .menu .opt, .menu [data-item], .menu a, .menu button { display: block; width: 100%; text-align: left; padding: .3rem .5rem; border: none; background: none; cursor: pointer; }
  .combo { border: 1px solid #d0d7de; border-radius: 6px; padding: .5rem; cursor: pointer; background: #fff; }
  .overlay { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; }
  .overlay .dialog, dialog { background: #fff; padding: 1.5rem; border-radius: 8px; border: none; max-width: 400px; }
  dialog.drawer { position: fixed; right: 0; top: 0; height: 100%; width: 90%; max-width: 440px; margin: 0; border-radius: 0; overflow-y: auto; box-shadow: -2px 0 12px rgba(0,0,0,.15); }
  dialog.drawer::backdrop { background: rgba(0,0,0,.35); }
  .tabs nav, .tabs [role=tablist], .tabs .tablist { display: flex; gap: 1rem; border-bottom: 1px solid #eaecef; margin-bottom: 1rem; }
  [aria-current=page], [aria-selected=true] { font-weight: 700; }
  iframe { border: 1px solid #eaecef; border-radius: 6px; }
`;
