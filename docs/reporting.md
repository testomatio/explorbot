# Test Reporting

Explorbot generates test reports using [@testomatio/reporter](https://github.com/testomatio/reporter).

Reports include test steps, screenshots, and result messages for every test run.

## Session Analysis

After `/explore` and `/freesail` runs, the [Analyst agent](./agents.md#analyst-agent) writes a human-readable summary that clusters findings by root cause.

The same markdown is printed to the console, written to disk, and (when the cloud reporter is enabled) set as the run description on Testomat.io.

**On disk:** `output/reports/<mode>-<sessionName>.md` — for example `explore-WiseFox42.md` or `freesail-CleverOwl91.md`. Each app run gets a unique name; nothing is overwritten.

**On Testomat.io:** the markdown lands as the run description, so the analysis sits next to the test list in the cloud dashboard without any extra setup.

See [Analyst Agent](./agents.md#analyst-agent) for the report format and configuration options.

## HTML Report (Local)

An HTML report is created automatically after each test run in `output/reports/<mode>-<sessionName>.html` (for example `explore-WiseFox42.html`). Each session gets its own file — nothing is overwritten across runs. Open it in a browser to review results, no configuration needed.

![HTML report](https://github.com/testomatio/explorbot/blob/main/docs/assets/html-report.png)

To get cloud reporting with history and team features, see the next section.

## Markdown Report (Local)

A markdown report can be written next to the HTML one. It's plain text — easy to paste into a PR description, a chat thread, or a CI summary.

Opt-in via `explorbot.config.js`:

```js
export default {
  reporter: {
    enabled: true,
    html: true,
    markdown: true,
  },
};
```

Output: `output/reports/<mode>-<sessionName>-tests.md` (for example `explore-WiseFox42-tests.md`). Like the HTML report, the filename is session-scoped so successive runs don't overwrite each other. The `-tests` suffix keeps it distinct from the [Analyst report](#session-analysis), which writes `<mode>-<sessionName>.md` in the same folder.

Unlike the HTML report, markdown is opt-in — it isn't generated unless `markdown: true` is set.

## Testomat.io Cloud Report

[Testomat.io](https://testomat.io) provides a cloud dashboard with test history, analytics, and team collaboration. Free with unlimited test runs.

![Testomat.io cloud report](https://github.com/testomatio/explorbot/blob/main/docs/assets/cloud-report.png)

### Setup

1. Register at [app.testomat.io](https://app.testomat.io)
2. Create an empty project
3. Copy the project API key

### Run with the key

```bash
TESTOMATIO=tstmt_your_key_here npx explorbot explore /
```

Set the key in your shell profile or CI environment so it's always active.

### Options

| Variable | Description |
|----------|-------------|
| `TESTOMATIO` | Project API key (required) |
| `TESTOMATIO_TITLE` | Custom name for the test run |
| `TESTOMATIO_ENV` | Environment label (e.g. `staging`, `production`) |
| `TESTOMATIO_SHARED_RUN` | Merge parallel executions into one run |
| `TESTOMATIO_RUNGROUP_TITLE` | Group successive runs under one heading (overrides `reporter.runGroup`) |

See [@testomatio/reporter docs](https://github.com/testomatio/reporter/blob/2.x/docs/pipes/testomatio.md) for the full list.

### Run group

Explorbot groups runs by day on Testomat.io. By default every run is filed under `Explorbot YYYY-MM-DD` (today's date), so all sessions from one day appear together in the dashboard.

Override per project via `explorbot.config.js`:

```js
export default {
  reporter: {
    enabled: true,
    runGroup: 'Smoke Suite',  // any string
    // runGroup: null,         // disable grouping entirely
  },
};
```

`TESTOMATIO_RUNGROUP_TITLE` from the environment, if set, takes precedence over the config.

## Screenshots in Cloud Reports

Explorbot captures screenshots during test execution. To see them in Testomat.io, configure an S3-compatible storage provider inside Testomat.io on Settings > Artifacts page. **This is highly recommended** — without it, screenshots won't be visible in cloud reports.

Set these environment variables:

```bash
S3_ACCESS_KEY_ID=your_access_key
S3_SECRET_ACCESS_KEY=your_secret_key
S3_BUCKET=your-bucket-name
S3_REGION=us-east-1
```

For non-AWS providers (DigitalOcean Spaces, Cloudflare R2, Google Cloud Storage, Minio), also set:

```bash
S3_ENDPOINT=https://your-provider-endpoint.com
```

See [@testomatio/reporter artifacts docs](https://github.com/testomatio/reporter/blob/2.x/docs/artifacts.md) for provider-specific examples.
