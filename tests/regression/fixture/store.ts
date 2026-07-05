const SEED_USERS: User[] = [
  { id: 1, email: 'demo@example.com', password: 'hunter2-fixture', name: 'Demo User' },
  { id: 2, email: 'admin@example.com', password: 'hunter2-admin', name: 'Admin User' },
];

const SEED_LABELS: Label[] = [
  { id: 1, name: 'bug', color: '#d73a4a' },
  { id: 2, name: 'feature', color: '#0e8a16' },
  { id: 3, name: 'docs', color: '#0075ca' },
  { id: 4, name: 'urgent', color: '#e99695' },
];

const SEED_ISSUES: Issue[] = [
  { id: 1, title: 'Login button unresponsive on mobile', description: 'The sign in button does nothing on small screens.', status: 'open', priority: 'high', labels: [1], assignees: [1], createdAt: '2026-01-02T09:00:00.000Z' },
  { id: 2, title: 'Add dark mode to settings', description: 'Users want a dark theme toggle in preferences.', status: 'open', priority: 'normal', labels: [2], assignees: [2], createdAt: '2026-01-03T10:30:00.000Z' },
  { id: 3, title: 'Document the REST API', description: 'The public API needs a reference page.', status: 'in_progress', priority: 'low', labels: [3], assignees: [1], createdAt: '2026-01-04T14:15:00.000Z' },
  { id: 4, title: 'Export report crashes on empty data', description: 'Exporting with no rows throws an error.', status: 'open', priority: 'critical', labels: [1, 4], assignees: [2], createdAt: '2026-01-05T08:45:00.000Z' },
  { id: 5, title: 'Improve search relevance', description: 'Search returns weakly related issues first.', status: 'closed', priority: 'normal', labels: [2], assignees: [1], createdAt: '2026-01-06T16:20:00.000Z' },
];

const SEED_COMMENTS: Comment[] = [
  { id: 1, issueId: 1, author: 'Demo User', text: 'Reproduced on iPhone Safari.' },
  { id: 2, issueId: 4, author: 'Admin User', text: 'This is blocking the release.' },
];

export function createStore(): Store {
  const users = SEED_USERS.map((u) => ({ ...u }));
  const labels = SEED_LABELS.map((l) => ({ ...l }));
  const issues = SEED_ISSUES.map((i) => ({ ...i, labels: [...i.labels], assignees: [...i.assignees] }));
  const comments = SEED_COMMENTS.map((c) => ({ ...c }));
  const sessions = new Map<string, number>();
  const activity: string[] = ['Demo User signed in', 'Issue #4 marked critical'];
  let nextIssueId = 6;
  let nextCommentId = 3;
  let tokenCounter = 0;

  function findUser(id: number): User | undefined {
    return users.find((u) => u.id === id);
  }

  function publicUser(u: User): PublicUser {
    return { id: u.id, email: u.email, name: u.name };
  }

  return {
    login(email, password) {
      const user = users.find((u) => u.email === email && u.password === password);
      if (!user) return null;
      tokenCounter += 1;
      const token = `sess-${user.id}-${tokenCounter}-${seedHex(tokenCounter)}`;
      sessions.set(token, user.id);
      activity.unshift(`${user.name} signed in`);
      return token;
    },

    logout(token) {
      sessions.delete(token);
    },

    userForToken(token) {
      if (!token) return null;
      const userId = sessions.get(token);
      if (!userId) return null;
      const user = findUser(userId);
      if (!user) return null;
      return publicUser(user);
    },

    listUsers() {
      return users.map(publicUser);
    },

    listLabels() {
      return labels.map((l) => ({ ...l }));
    },

    listIssues(filter = {}) {
      let result = issues.map((i) => ({ ...i }));
      if (filter.status) result = result.filter((i) => i.status === filter.status);
      if (filter.label) {
        const labelId = Number(filter.label);
        result = result.filter((i) => i.labels.includes(labelId));
      }
      if (filter.q) {
        const needle = filter.q.toLowerCase();
        result = result.filter((i) => i.title.toLowerCase().includes(needle) || i.description.toLowerCase().includes(needle));
      }
      return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    getIssue(id) {
      const issue = issues.find((i) => i.id === id);
      if (!issue) return null;
      return { ...issue };
    },

    createIssue(input) {
      const title = (input.title || '').trim();
      if (!title) return { error: 'Title is required' };
      const issue: Issue = {
        id: nextIssueId,
        title,
        description: input.description || '',
        status: 'open',
        priority: input.priority || 'normal',
        labels: (input.labels || []).map(Number),
        assignees: (input.assignees || []).map(Number),
        createdAt: `2026-02-01T12:00:${String(nextIssueId).padStart(2, '0')}.000Z`,
      };
      nextIssueId += 1;
      issues.push(issue);
      activity.unshift(`Issue #${issue.id} created: ${issue.title}`);
      return { issue: { ...issue } };
    },

    updateIssue(id, patch) {
      const issue = issues.find((i) => i.id === id);
      if (!issue) return null;
      if (patch.status) issue.status = patch.status;
      if (patch.priority) issue.priority = patch.priority;
      if (patch.title) issue.title = patch.title;
      if (patch.description !== undefined) issue.description = patch.description;
      if (patch.labels) issue.labels = patch.labels.map(Number);
      if (patch.assignees) issue.assignees = patch.assignees.map(Number);
      activity.unshift(`Issue #${issue.id} updated`);
      return { ...issue };
    },

    deleteIssue(id) {
      const index = issues.findIndex((i) => i.id === id);
      if (index === -1) return false;
      const [removed] = issues.splice(index, 1);
      activity.unshift(`Issue #${removed.id} deleted`);
      return true;
    },

    listComments(issueId) {
      return comments.filter((c) => c.issueId === issueId).map((c) => ({ ...c }));
    },

    addComment(issueId, author, text) {
      const clean = (text || '').trim();
      if (!clean) return { error: 'Comment text is required' };
      const comment: Comment = { id: nextCommentId, issueId, author, text: clean };
      nextCommentId += 1;
      comments.push(comment);
      activity.unshift(`Comment added to issue #${issueId}`);
      return { comment: { ...comment } };
    },

    recentActivity() {
      return activity.slice(0, 10);
    },
  };
}

function seedHex(n: number): string {
  const base = (n * 2654435761) % 0xffffffff;
  return Math.abs(base).toString(16).padStart(8, '0');
}

interface User {
  id: number;
  email: string;
  password: string;
  name: string;
}

interface PublicUser {
  id: number;
  email: string;
  name: string;
}

interface Label {
  id: number;
  name: string;
  color: string;
}

interface Comment {
  id: number;
  issueId: number;
  author: string;
  text: string;
}

type IssueStatus = 'open' | 'in_progress' | 'closed';
type IssuePriority = 'low' | 'normal' | 'high' | 'critical';

interface Issue {
  id: number;
  title: string;
  description: string;
  status: IssueStatus;
  priority: IssuePriority;
  labels: number[];
  assignees: number[];
  createdAt: string;
}

interface IssueFilter {
  status?: string;
  label?: string;
  q?: string;
}

interface IssueInput {
  title?: string;
  description?: string;
  priority?: IssuePriority;
  labels?: (string | number)[];
  assignees?: (string | number)[];
}

interface IssuePatch {
  status?: IssueStatus;
  priority?: IssuePriority;
  title?: string;
  description?: string;
  labels?: (string | number)[];
  assignees?: (string | number)[];
}

export interface Store {
  login(email: string, password: string): string | null;
  logout(token: string): void;
  userForToken(token: string | null): PublicUser | null;
  listUsers(): PublicUser[];
  listLabels(): Label[];
  listIssues(filter?: IssueFilter): Issue[];
  getIssue(id: number): Issue | null;
  createIssue(input: IssueInput): { issue?: Issue; error?: string };
  updateIssue(id: number, patch: IssuePatch): Issue | null;
  deleteIssue(id: number): boolean;
  listComments(issueId: number): Comment[];
  addComment(issueId: number, author: string, text: string): { comment?: Comment; error?: string };
  recentActivity(): string[];
}

export type { Issue, Label, PublicUser, Comment, IssueStatus, IssuePriority };
