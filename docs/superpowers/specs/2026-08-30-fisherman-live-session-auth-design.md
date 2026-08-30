# Fisherman Live-Session Auth — Design

## Problem

Langfuse trace `de95bd1cffce09169599d99d1bee56cd` (2026-08-30, beta.testomat.io, project `zyntra-don-t-touch-cloned`): every Fisherman write returned `403 {"error":"Unauthorized"}` in ~8ms while the same browser session performed successful writes to the same project minutes earlier. The requests were rejected at the auth layer because Fisherman assembled stale credentials:

1. `cookieProvider` (`src/explorbot.ts`) serialized `page.context().cookies()` — the **entire jar, unfiltered** — producing a doubled `Cookie` header with a dead `localhost` session pair ahead of the valid one. A real browser never sends localhost cookies to another host.
2. `extractAuthHeaders` (`src/api/request-store.ts`) scraped `x-csrf-token` from a **2026-07-07 capture of another project** (`imr_manual12`). The store iterates `capturedRequests` from the end, but `loadFromDisk` fills it in alphabetical filename order, so "last" means alphabetically-late, not newest. `output/requests/` is a graveyard spanning months and many projects, so any stale credential can win.
3. `refreshAuth` (`src/ai/fisherman.ts`) applies live cookies **before** capture-scraped headers, so a captured `cookie` header (in `AUTH_HEADERS`) could even clobber the fresh jar.

## Principle

**Captures are a source of API shape — endpoints, body examples — which is durable across sessions. They are never a source of credentials, which are ephemeral.** Credentials come from the live browser session or from explicit `api.headers` config. This rules out any future re-accretion of header scraping from old captures.

## Decisions

- **D1 — Cookies from the live jar, filtered by the API origin.** `page.context().cookies(baseEndpoint)`: Playwright applies the same domain/path matching a browser applies when sending to that URL. No manual dedup — same-name cookies on parent/child domains are legitimate browser behavior and Playwright's filter already yields exactly what the browser would send.
- **D2 — Never scrape cookies from captures.** `'cookie'` leaves `AUTH_HEADERS`. The jar is the single, always-current source of cookies.
- **D3 — Auth headers only from current-session captures, newest first.** `RequestStore` records `sessionStartedAt` at construction; `extractAuthHeaders` considers only captures with `timestamp >= sessionStartedAt`, sorted newest-first. Live captures (added by `XhrCapture` during this run) pass; the disk graveyard never does. This also resolves same-id collisions (an old `xhr_001_…` disk file vs a live capture reusing that counter id): the gate keeps only the live one.
- **D4 — Precedence: captured < live browser < config.** `refreshAuth` applies session-capture headers first, live browser headers second (current session replaces old), explicit `configHeaders` last (user intent stays authoritative). Still refreshed once per episode — the browser is idle while Fisherman runs.
- **D4a — Replicate mode only.** Browser-derived credentials (jar cookies, page CSRF token, session-capture headers) apply only in replicate mode, where Fisherman replays what the browser does. In achieve mode the API contract is explicit and authentication comes solely from `api.headers` config — injecting browser cookies there would be surprising and can leak a UI session into a separately-authenticated API.
- **D5 — Live CSRF token from the page (severable).** The provider also reads `meta[name="csrf-token"]` from the current page and sends it as `x-csrf-token`. This is a cross-framework web convention (Rails, Laravel), the same class of structural knowledge as ARIA attributes or URL anatomy — not a site-specific locator. `cookieProvider` is renamed `browserHeaderProvider` since it now supplies all live-browser-derived headers. Cutting this decision cuts only Task 4 of the plan; Tasks 1–3 stand alone.
- **D6 — A capture without a timestamp is stale.** `RequestResult.load` currently stamps load-time for a file missing `timestamp`, which would slip past the session gate; absent timestamp now parses as epoch.

## Declared behavior change

`Authorization` / `x-api-key` values scraped from **previous-session** captures are no longer sent. Cookie-authenticated apps are unaffected (the jar is live). An app that was only ever authenticated through a stale captured token now fails honestly instead of sending dead credentials — the remedy is `api.headers` in config.

## Out of scope

- Prompt changes to make the model stop faster on `authorization` failures (the 4-failure guard already bounds it).
- Pilot's final verdict misattributing the failure to later tester errors instead of the failed precondition.
- Mirroring the `XSRF-TOKEN` cookie into an `X-XSRF-TOKEN` header (Angular/Laravel convention) — add only if a real trace shows it's needed.

## Acceptance

A run against a cookie-authenticated app where Fisherman's writes carry only the cookies the current browser session would send to the API origin, plus a current CSRF token — verified by the request ledger in `output/requests/` showing a single-valued `Cookie` header matching the live session and no header value originating from a previous session's captures.
