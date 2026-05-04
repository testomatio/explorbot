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

An HTML report is created automatically after each test run in `output/reports/`. Open it in your browser to review results — no configuration needed.

![HTML report](https://github.com/testomatio/explorbot/blob/main/docs/assets/html-report.png)

To get cloud reporting with history and team features, see the next section.

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

See [@testomatio/reporter docs](https://github.com/testomatio/reporter/blob/2.x/docs/pipes/testomatio.md) for the full list.

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
