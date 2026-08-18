# WebSocket Stream

`--ws <url>` (or `EXPLORBOT_WS_URL`) streams a run to your own UI. Explorbot dials **out** — your side is the server — so the same flag covers a child process you spawned and a CI bot connecting from elsewhere.

```bash
npx explorbot explore /dashboard --ws ws://127.0.0.1:8787
```

Every message is JSON with a `type` and a `ts`, plus whatever that type carries. Nothing is validated on either side: render the types you know, ignore the rest, and expect new ones.

## What a run sends

| Type | What it is |
|---|---|
| `hello` | the run itself: command, working directory, pid |
| `state` | the page under test: url, path, title, heading |
| `test` | a test starting or finishing, with its status, result and plan |
| `plan` | the current plan and the status of every test in it |
| `screenshot` | the screenshot file just written |
| `research` | the researcher's map of a page: markdown and its file |
| `report` | the analyst's end-of-session report: markdown and its file |
| `activity` | what the run is doing this second |
| `log` | a log line and its level |
| `ask` | a question for a human, carrying an `askId` |
| `result` | the run exited, with its code |

Each type carries the latest truth, so keep the last frame per type — that is what the terminal itself shows.

## What you can send back

| Type | What it does |
|---|---|
| `answer` | answers an `ask`: same `askId`, plus `value` — or `null` to skip the question |
| `interrupt` | stops the current step; the run then asks what to do instead |

A run with nobody to answer never asks in the first place, so connecting a listener that answers is what makes a headless run interactive.

## Delivery

Frames queue while disconnected — the last 1000 — and the connection retries on its own, so treat it as a live feed rather than a history. On exit the queue is flushed after `result`.

## Adding a frame

Frames are logged, not published:

```ts
tag('data').log('coverage', { visited: 12, total: 30 });
```

That reaches listeners as a `coverage` frame. A `data` entry never goes to the console, the log file, or the TUI.
