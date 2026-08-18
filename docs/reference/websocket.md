# WebSocket Stream

`--ws <url>` streams a run to your own UI over one WebSocket: the log, what the run is testing right now, the artifacts it writes, and the questions it needs answered.

Explorbot dials **out**, so the same flag covers a child process your app spawned and a CI bot connecting from elsewhere. Your side is the server.

```bash
npx explorbot explore /dashboard --ws ws://127.0.0.1:8787
EXPLORBOT_WS_URL=ws://127.0.0.1:8787 npx explorbot test output/plans/plan.md
```

The flag works on every command, boats included: `npx explorbot api explore --ws …`, `npx explorbot prima check --ws …`.

A listener is a plain WebSocket server:

```js
Bun.serve({
  port: 8787,
  fetch: (req, server) => server.upgrade(req) ? undefined : new Response('expected a websocket', { status: 400 }),
  websocket: {
    message(ws, raw) {
      const frame = JSON.parse(String(raw));
      if (frame.type === 'test') console.log(frame.status, frame.scenario);
      if (frame.type === 'ask') ws.send(JSON.stringify({ type: 'answer', askId: frame.askId, value: 'admin/admin' }));
    },
  },
});
```

## The envelope

Every frame is one JSON message with a `type` and a `ts` (epoch milliseconds), plus whatever that type carries:

```json
{ "type": "test", "ts": 1755500000000, "scenario": "Buy a hat", "status": "in_progress", "result": null }
```

There is no schema negotiation and no version. Render the types you recognise and ignore the rest — new types and new fields can appear in any release, and neither side validates the other's shape.

## Frames from Explorbot

| Type | Sent when |
|---|---|
| `hello` | Once, as the run attaches |
| `state` | The browser reaches a new page state |
| `test` | A test starts, and again when it finishes |
| `plan` | The plan is generated, loaded, or any test in it changes |
| `screenshot` | A screenshot file is written |
| `research` | A page's research is written or reused |
| `report` | The end-of-session report is written |
| `activity` | The spinner text changes — what the run is doing this second |
| `log` | Anything is logged |
| `ask` | The run needs an answer from a human |
| `result` | The run is exiting |

### `hello`

The first frame of every run. Sent before the socket is even open, so it is the first thing delivered once it connects.

| Field | Type | Meaning |
|---|---|---|
| `command` | string | The command being run, e.g. `explore`, `test`, `api explore` |
| `cwd` | string | Working directory of the run |
| `pid` | number | Process id |

```json
{ "type": "hello", "ts": 1755500000000, "command": "explore", "cwd": "/home/me/app", "pid": 4242 }
```

### `state`

The page under test, sent on every state change — a navigation, or a change big enough to count as a new state (a modal opening, for instance).

| Field | Type | Meaning |
|---|---|---|
| `url` | string | Absolute URL |
| `path` | string | Path only, the form used in plans and knowledge files |
| `title` | string | Page title |
| `h1` | string \| undefined | First heading, when the page has one |

```json
{ "type": "state", "ts": 1755500000000, "url": "https://shop.test/checkout", "path": "/checkout", "title": "Checkout", "h1": "Your order" }
```

### `test`

The test in flight. Sent twice per test: once at the start, once at the end.

| Field | Type | Meaning |
|---|---|---|
| `scenario` | string | What the test does — its title |
| `status` | `pending` \| `in_progress` \| `done` | `in_progress` at the start, `done` at the end |
| `result` | `passed` \| `failed` \| `skipped` \| `null` | `null` until the test finishes |
| `priority` | `critical` \| `important` \| `high` \| `normal` \| `low` | Assigned by the planner |
| `sessionName` | string | Unique name for this run of the test, the handle used to inspect it afterwards |
| `url` | string | Path the test starts from |
| `plan` | string \| undefined | Title of the plan it belongs to |

```json
{ "type": "test", "ts": 1755500000000, "scenario": "Buy a hat", "status": "done", "result": "passed",
  "priority": "high", "sessionName": "brave-otter", "url": "/checkout", "plan": "/checkout" }
```

Tests run outside a plan — drilling a component, re-running a generated file — report the same way, with `plan` absent.

### `plan`

The whole plan, whenever it changes: generated, loaded from markdown, extended, or advanced by a test starting or finishing. Expect it alongside most `test` frames.

| Field | Type | Meaning |
|---|---|---|
| `title` | string | Plan title, a path when the plan targets one page |
| `url` | string \| undefined | Path the plan starts from |
| `tests` | array | Every test: `scenario`, `status`, `result`, `priority` — same values as the `test` frame |

```json
{ "type": "plan", "ts": 1755500000000, "title": "/checkout", "url": "/checkout",
  "tests": [{ "scenario": "Buy a hat", "status": "done", "result": "passed", "priority": "high" }] }
```

### `screenshot`

A screenshot file was written. Sent for the shots taken during page capture and for the ones an agent takes on purpose.

| Field | Type | Meaning |
|---|---|---|
| `path` | string | Absolute path to the `.png`, under `output/states/` |

Paths are local to the machine running Explorbot. A UI on the same host can read them directly; a remote one needs the file shipped some other way.

### `research`

A page's research — the markdown map of what the researcher found. Sent when research is written and when a page reuses what was already researched, so the frame always describes the page being worked on.

| Field | Type | Meaning |
|---|---|---|
| `path` | string | Absolute path to the markdown file, under `output/research/` |
| `hash` | string | State hash the research belongs to — the same page state reuses it |
| `content` | string | The research markdown, in full |

### `report`

The end-of-session report the analyst writes: what works, defects, UX issues, execution problems.

| Field | Type | Meaning |
|---|---|---|
| `path` | string | Absolute path, under `output/reports/` |
| `content` | string | The report markdown, in full |

A long run reports more than once — the report is refreshed at the end of an exploration pass and again when the session ends — each frame superseding the last.

### `activity`

What the run is doing at this moment, the text the terminal shows next to the spinner. Repeats are suppressed.

| Field | Type | Meaning |
|---|---|---|
| `message` | string \| null | The activity, `null` when the run goes idle |
| `kind` | `ai` \| `action` \| `navigation` \| `general` \| undefined | What sort of work it is |

### `log`

Every log line, tagged with the kind the terminal uses to style it.

| Field | Type | Meaning |
|---|---|---|
| `level` | string | `info`, `success`, `error`, `warning`, `step`, `substep`, `operation`, `multiline`, `details`, `input` |
| `content` | string | The message, ANSI stripped, capped at 8000 characters with `… (N chars)` appended |
| `error` | string \| undefined | Error message when the entry carries one — a failed `step`, for instance |

`step` is a browser action (`I.click("Sign in")`), `operation` is internal progress, `multiline` and `details` are markdown blocks. Debug logging and raw HTML dumps are never streamed.

### `ask`

The run needs a human: credentials the Navigator cannot guess, a decision the Pilot cannot make, a prompt from a drill. Answer it with an `answer` frame carrying the same `askId`.

| Field | Type | Meaning |
|---|---|---|
| `askId` | string | Correlation id, e.g. `ask-1` |
| `prompt` | string | The question |

An unanswered ask times out after 15 minutes and the run continues as if it was skipped. Connecting a UI that answers asks is also what makes a run interactive — without one, a headless run never asks in the first place.

### `result`

The run is exiting. Sent by `close()`, which flushes the queue before the process ends.

| Field | Type | Meaning |
|---|---|---|
| `ok` | boolean | True when the exit code is `0` |
| `exitCode` | number | Process exit code |

## Frames to Explorbot

### `answer`

Answers an `ask`. `value` is the reply, or `null` to skip the question.

```json
{ "type": "answer", "askId": "ask-1", "value": "admin@example.com / secret123" }
```

### `interrupt`

Stops what the run is doing right now, the way Esc does in the terminal: the AI call in flight is aborted, and the run then asks what to do instead — which arrives as an `ask` frame. Answer it to redirect the run, or answer `null` to let it carry on.

```json
{ "type": "interrupt" }
```

Any other frame you send is ignored, so a UI can speak first and grow its vocabulary later.

## Delivery

- **Frames queue while disconnected.** Up to 1000 are held; past that the oldest are dropped. A UI that connects late gets what is still in the queue — one-shot frames such as `hello` or an early `plan` can be missed, so treat the stream as a live feed rather than a full history.
- **The connection retries by itself**, backing off from 0.5s to 10s, and the queue drains on reconnect.
- **Exit is flushed.** `result` is sent and the queue is drained, for up to 3 seconds, before the process ends.
- **Each type carries the latest truth.** Keep the last frame per type — that is what the terminal itself shows.

## Adding a frame

Frames are logged, not published: anything logged as `data` is sent as a frame, with the first argument as the type and the second as its body.

```ts
tag('data').log('coverage', { visited: 12, total: 30 });
```

That reaches a listener as `{"type": "coverage", "ts": …, "visited": 12, "total": 30}`. A `data` entry never reaches the console, the log file, or the TUI log pane — it is a payload for whoever is listening, not a message for a human.
