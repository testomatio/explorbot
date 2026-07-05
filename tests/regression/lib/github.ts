import { readFileSync } from 'node:fs';

export const DISCUSSION_CATEGORY = 'Regression Reports';

export const DISCUSSION_QUERY = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    id
    discussionCategories(first: 25) { nodes { id name } }
  }
}`;

export const DISCUSSION_MUTATION = `mutation($repo: ID!, $cat: ID!, $title: String!, $body: String!) {
  createDiscussion(input: { repositoryId: $repo, categoryId: $cat, title: $title, body: $body }) {
    discussion { url }
  }
}`;

export function prNumberFromEvent(): number | null {
  const path = process.env.GITHUB_EVENT_PATH;
  if (!path) return null;
  const payload = JSON.parse(readFileSync(path, 'utf-8'));
  const number = payload?.pull_request?.number;
  if (!number) return null;
  return Number(number);
}

export function repoOwnerAndName(): { owner: string; name: string } | null {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) return null;
  const [owner, name] = repo.split('/');
  if (!owner || !name) return null;
  return { owner, name };
}
