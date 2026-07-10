# Running API Tests

Once Chief has written a plan, Curler runs it. Curler reads each scenario and drives it to a pass or fail by making real HTTP requests and asserting on the responses.

## Run a plan

Point Curler at a plan file:

```bash
npx explorbot api test output/plans/users.md
```

With no index, Curler runs every pending test. Add an index to run a subset:

```bash
npx explorbot api test output/plans/users.md 1      # the first test
npx explorbot api test output/plans/users.md 1-3    # tests 1 through 3
npx explorbot api test output/plans/users.md 1,3,5  # specific tests
npx explorbot api test output/plans/users.md *      # all pending tests
```

Curler prints a running log of requests and, at the end, how many tests passed and failed.

## What Curler can do

Curler works through AI tool calls. Its toolset:

- **`request`** — make an HTTP request (any method: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS) with a body, headers, or query params. Returns status, timing, and a preview of the response; the full body is saved to disk. This is how Curler chains requests — it reads an ID from one response and feeds it into the next.
- **`verifyStructure`** — check the response shape against a Zod schema. On success it reports the actual structure, which Curler uses to write correct value assertions.
- **`verifyData`** — assert specific values with `expect()` (`toBe`, `toHaveProperty`, `toHaveLength`, and so on).
- **`schemaFor`** — search the OpenAPI spec for related endpoints when a test needs to set up prerequisite data or discover a dependency.
- **`record`** — note a finding or observation as the test runs.
- **`finish`** / **`stop`** — mark the test complete, or abandon it when the scenario is impossible.

Curler favors verification over trust: for writes, it follows up with a `GET` to confirm the data actually persisted rather than believing the write response alone.

## Debugging with request logs

Every request Curler makes is saved to `output/requests/` as a `.request.yaml` file — full URL, headers, body, status, and response. When a test fails and the log isn't enough, open these to see exactly what went over the wire, including a reproducible curl command.

## Explore an endpoint end to end

`explore` runs the whole cycle autonomously across every planning style:

```bash
npx explorbot api explore /users
```

For each style — `normal`, `curious`, `psycho`, `hacker` — it plans a fresh set of scenarios, runs them with Curler, and saves one plan file per style (`users_normal.md`, `users_hacker.md`, and so on). Scenarios are de-duplicated across styles, so the same test won't run twice. When every style is done, it prints the combined totals.

Use `explore` to hammer an endpoint from every angle in one command; use `plan` plus `test` when you want to review or edit scenarios before running them.

## Results and reporting

Pass/fail results flow through Explorbot's shared reporter — the same one the web side uses. See [reporting](../workflow/reporting.md) for local reports and sending runs to Testomat.io.
