# Choosing What to Crawl

With defaults, a run crawls everything it can reach on the same origin, up to 100 pages. That is often too much — the crawler wanders into settings and profile pages — or too little, burning the budget before it reaches the part you care about. The options below control where it goes. All of them live under the `docs` key in `docbot.config.ts`.

## How the queue is built

After documenting a page, the crawler queues new targets from three sources: links found on the page, navigation entries identified by research (this is how hash-navigated pages such as OpenAPI reference docs get crawled), and URLs discovered through clicks when [interactive mode](./interactive-mode.md) is on. Every target must pass the filters on this page before it is queued. Pages already visited in this session are not revisited, and the crawl stops early if it detects a dead loop.

## maxPages — the budget

The crawl stops once this many pages are documented. Skipped pages — failed navigation, low-signal pages — do not count against the budget. `--max-pages` on the command line overrides the config for one run.

```ts
docs: {
  maxPages: 30,
}
```

## scope — how far from the start path

`scope` bounds the crawl relative to the path you start from:

```ts
docs: {
  scope: 'subtree',
}
```

- `site` (default) — anywhere on the same origin.
- `subtree` — only the start path and paths beneath it. Starting at `/admin/reports` allows `/admin/reports/2026` but blocks `/admin/users`.
- `section` — like `subtree`, plus sibling paths that extend the start path with a dash. Starting at `/docs/api` also allows `/docs/api-reference`.

The scope root is the start path (capped at its first four segments for deeper paths). Links outside the scope are never queued.

## includePaths and excludePaths

Path filters for finer control than `scope`:

```ts
docs: {
  excludePaths: ['/settings/*', '/help/*'],
}
```

Patterns match the URL path: exact paths, `/admin/*` for a path and everything under it, glob patterns like `/users/*/edit`, or a regex prefixed with `^`.

`excludePaths` blocks matching paths. `includePaths` inverts the logic: when it is non-empty, only matching paths are crawled — and it becomes the only filter. `excludePaths` and `deniedPathSegments` are not consulted, so keep include patterns tight enough that they cannot match destructive endpoints.

## deniedPathSegments — the safety list

The crawler follows links in a real browser. Some links are dangerous to follow: `/logout` ends the session, and `delete`- or `destroy`-style endpoints can modify data with a single request. Any URL with a path segment on this list is never queued.

The default list covers sign-out endpoints (`logout`, `signout`, `sign_out`), destructive actions (`delete`, `destroy`, `remove`), and OAuth `callback` routes. Matching is by whole segment, case-insensitive: `/users/delete/3` is blocked because one segment equals `delete`; `/deleted-items` is not.

Setting `deniedPathSegments` replaces the built-in list, so keep the defaults when adding your own entries.

## collapseDynamicPages — one page per template

Apps repeat the same page under many URLs: `/users/1`, `/users/2`, and so on. By default, URLs that differ only in dynamic segments (numeric IDs, UUIDs, hashes) count as the same page, and the first one reached represents them all.

```ts
docs: {
  collapseDynamicPages: false,
}
```

Set it to `false` when such pages genuinely differ and you want each URL documented separately. Expect the page budget to fill up faster.
