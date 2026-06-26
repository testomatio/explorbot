# Test Reporting

Explorbot generates test reports with [@testomatio/reporter](https://github.com/testomatio/reporter). Reports include test steps, screenshots, and result messages for every run.

## Session analysis

After `/explore` and `/freesail` runs, the [Analyst agent](../reference/agents.md#analyst-agent) writes a summary that clusters findings by root cause.

The same markdown is printed to the console, written to disk, and set as the run description on Testomat.io when the cloud reporter is enabled.

**On disk:** `output/reports/<mode>-<sessionName>.md` — for example `explore-WiseFox42.md` or `freesail-CleverOwl91.md`. Each run gets a unique name, so nothing is overwritten.

**On Testomat.io:** the markdown becomes the run description, so the analysis sits next to the test list in the cloud dashboard with no extra setup.

See [Analyst Agent](../reference/agents.md#analyst-agent) for the report format and configuration options.

## HTML report (local)

Explorbot creates an HTML report after each run in `output/reports/<mode>-<sessionName>.html`, for example `explore-WiseFox42.html`. Each session gets its own file, so nothing is overwritten. Open it in a browser to review results. No configuration needed.

![HTML report](https://github.com/testomatio/explorbot/blob/main/docs/assets/html-report.png)

For cloud reporting with history and team features, see the next section.

## Markdown report (local)

Explorbot can write a markdown report next to the HTML one. It's plain text, so you can paste it into a PR description, a chat thread, or a CI summary.

Opt in via `explorbot.config.js`:

```js
export default {
  reporter: {
    enabled: true,
    html: true,
    markdown: true,
  },
};
```

Output: `output/reports/<mode>-<sessionName>-tests.md`, for example `explore-WiseFox42-tests.md`. Like the HTML report, the filename is session-scoped, so successive runs don't overwrite each other. The `-tests` suffix keeps it distinct from the [Analyst report](#session-analysis), which writes `<mode>-<sessionName>.md` in the same folder.

The markdown report is opt-in. It isn't generated unless you set `markdown: true`.

## Testomat.io cloud report

[Testomat.io](https://testomat.io) provides a cloud dashboard with test history, analytics, and team collaboration. It's free with unlimited test runs.

![Testomat.io cloud report](https://github.com/testomatio/explorbot/blob/main/docs/assets/cloud-report.png)

### Setup

1. Register at [app.testomat.io](https://app.testomat.io).
2. Create an empty project.
3. Copy the project API key.

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

See the [@testomatio/reporter docs](https://github.com/testomatio/reporter/blob/2.x/docs/pipes/testomatio.md) for the full list.

### Run group

Explorbot groups runs by day on Testomat.io. By default, every run is filed under `Explorbot YYYY-MM-DD` (today's date), so all sessions from one day appear together in the dashboard.

Override it per project via `explorbot.config.js`:

```js
export default {
  reporter: {
    enabled: true,
    runGroup: 'Smoke Suite',  // any string
    // runGroup: null,         // disable grouping entirely
  },
};
```

If set, `TESTOMATIO_RUNGROUP_TITLE` from the environment takes precedence over the config.

## Screenshots in cloud reports

Explorbot captures screenshots during a run. To see them in Testomat.io, configure an S3-compatible storage provider under Settings > Artifacts in Testomat.io. Without it, screenshots won't appear in cloud reports.

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

See the [@testomatio/reporter artifacts docs](https://github.com/testomatio/reporter/blob/2.x/docs/artifacts.md) for provider-specific examples.
