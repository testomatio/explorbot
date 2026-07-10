# Continuous Integration

Once your Explorbot setup works locally — it logs in, explores, and produces sensible tests — the next step is to run it on a schedule, so the whole app gets re-tested continuously without anyone starting it by hand. This page shows what a CI run needs and gives a worked pipeline for the common providers. If you haven't run Explorbot headlessly yet, read [Running Explorbot](../basics/running.md) first.

## What a CI run needs

- **A provider API key from the environment.** Your local `.env` file is not in the repo; in CI, set the key (for example `OPENROUTER_API_KEY`) as a pipeline secret and pass it as an environment variable.
- **Playwright browsers.** Install them in the job: `npx playwright install --with-deps chromium`.
- **A headless browser.** That's the default — don't pass `--show` and there is nothing to configure.
- **A start path and a test budget.** `npx explorbot explore / --max-tests 10` keeps the run bounded and predictable.
- **A hard timeout as backstop.** AI runs can stall; a job-level timeout guarantees the pipeline never hangs.

For login, commit your `knowledge/` directory to the repo — it's the input you control, and Explorbot reads it on every run. Keep credentials out of the files with `${env.NAME}` interpolation, as described in [Knowledge](./knowledge.md), and set those variables as pipeline secrets too. Add `--session` to the run command so Explorbot logs in once and reuses the saved session.

## Cache, commit, or upload

Three directories, three fates:

- **Commit `knowledge/`.** It's authored by you and versioned like code.
- **Cache `experience/` and `output/`.** `experience/` carries lessons between runs — fewer repeated failures, faster runs — so a cached CI job gets smarter every night instead of starting from zero. `output/` carries `session.json` plus previous plans and generated tests; with `--configure` the next run reloads a saved plan and re-runs its tests regression-style instead of planning everything fresh (see the [`--configure` reference](../reference/commands.md#explore)).
- **Upload `output/reports/`, `output/tests/`, and `output/screencasts/` as artifacts.** Reports and screencasts are for humans to review after the run; generated tests are code you may want to review and commit. If you send results to Testomat.io with artifact storage, screencasts are already attached to tests there — see [Reporting on CI](#reporting-on-ci).

## Exit codes and gating

As covered in [Running Explorbot](../basics/running.md#exit-codes), `explore` exits `1` only when the run itself crashes — bad config, unreachable app, provider failure. Failing tests do not fail the job; they are findings, not crashes. So a green pipeline means "Explorbot ran", not "no bugs found".

To see what it found, read the session report in `output/reports/` — the Analyst writes a markdown summary that clusters defects by root cause. For per-test pass/fail in machine-checkable form, enable the markdown test report or send results to Testomat.io with the `TESTOMATIO` project key; both are described in [Reporting](./reporting.md). API tests are stricter: `api test` and `api explore` exit `1` when any test fails, so they gate natively.

## Reporting on CI

A scheduled run is only worth having if its results are easy to review the next morning. The recommended stack gives you a report you read top-down — start at the overview, drill into a failing test, watch exactly what happened:

1. **Send results to Testomat.io.** Add the `TESTOMATIO` project key as a pipeline secret. Every run lands in the dashboard with steps, statuses, and history — nothing to download from CI.
2. **Enable artifact storage.** Connect an S3-compatible bucket under Settings > Artifacts in Testomat.io (credentials via `S3_*` pipeline variables — see [artifacts in cloud reports](./reporting.md#artifacts-in-cloud-reports)). Screenshots and screencasts attached to tests upload automatically.
3. **Record screencasts.** Every test becomes a video with the executed actions and the current scenario step overlaid — reviewing one beats clicking through a screenshot trail.
4. **Enable the Analyst.** Its summary becomes the run description on Testomat.io, so the run opens with defects clustered by root cause, coverage, and what works.

The two config switches, next to your reporter settings:

```js
export default {
  ai: {
    agents: {
      historian: { screencast: true },
      analyst: { enabled: true },
    },
  },
};
```

The review flow this buys: open the run, read the Analyst overview in the description, scan the failed tests, open one, watch its screencast.

Without the cloud reporter, the fallback is `html: true` and `markdown: true` under `reporter` plus uploading `output/reports/` and `output/screencasts/` as CI artifacts — the pipelines below do. You lose history and the overview-to-video flow, but every run is still reviewable.

**API runs** report through the same reporter, so the same `TESTOMATIO` key covers `api test` and `api explore`. There are no screencasts (no browser) and the Analyst covers web sessions only; upload `output/requests/` as a CI artifact instead — every request and response is logged there as YAML.

## GitHub Actions

A nightly run with caching, artifacts, and a manual trigger:

```yaml
name: Explorbot Nightly

on:
  schedule:
    - cron: '0 3 * * *'
  workflow_dispatch:

jobs:
  explore:
    runs-on: ubuntu-latest
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 24

      - run: npm ci
      - run: npx playwright install --with-deps chromium

      - uses: actions/cache@v4
        with:
          path: |
            experience
            output
          key: explorbot-${{ github.run_id }}
          restore-keys: |
            explorbot-

      - run: npx explorbot explore / --max-tests 10 --session
        env:
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: explorbot-results
          path: |
            output/reports
            output/tests
            output/screencasts
```

The cache key includes the run id, so every run saves an updated cache and the next one restores the latest via `restore-keys`. To report runs to Testomat.io, add `TESTOMATIO: ${{ secrets.TESTOMATIO }}` to the `env` block — see [Reporting](./reporting.md).

## GitLab CI

Create the schedule under **CI/CD → Pipeline schedules** and set `OPENROUTER_API_KEY` as a masked CI/CD variable. The job itself:

```yaml
explorbot:
  image: node:24
  rules:
    - if: $CI_PIPELINE_SOURCE == "schedule"
  timeout: 1h
  cache:
    key: explorbot
    paths:
      - experience/
      - output/
  script:
    - npm ci
    - npx playwright install --with-deps chromium
    - npx explorbot explore / --max-tests 10 --session
  artifacts:
    when: always
    paths:
      - output/reports/
      - output/tests/
      - output/screencasts/
```

## Jenkins

Jenkins has no built-in cross-run cache, but the workspace persists between builds on the same agent — so `experience/` and `output/` carry over as long as you don't wipe the workspace (skip `cleanWs`, or use the Job Cacher plugin on those two directories).

```groovy
pipeline {
  agent any
  triggers { cron('H 3 * * *') }
  options { timeout(time: 60, unit: 'MINUTES') }
  environment { OPENROUTER_API_KEY = credentials('openrouter-api-key') }
  stages {
    stage('Explore') {
      steps {
        sh 'npm ci'
        sh 'npx playwright install --with-deps chromium'
        sh 'npx explorbot explore / --max-tests 10 --session'
      }
    }
  }
  post {
    always {
      archiveArtifacts artifacts: 'output/reports/**, output/tests/**, output/screencasts/**', allowEmptyArchive: true
    }
  }
}
```

## Azure Pipelines

Scheduled triggers are declared in the pipeline itself; `always: true` runs it even without new commits. Set the API key as a secret pipeline variable. Azure caches one path per `Cache@2` task and keys are immutable, so use two tasks with the same rolling-key pattern as the GitHub example.

```yaml
schedules:
  - cron: '0 3 * * *'
    branches:
      include: [main]
    always: true

pool:
  vmImage: ubuntu-latest

steps:
  - task: NodeTool@0
    inputs:
      versionSpec: '24.x'
  - task: Cache@2
    inputs:
      key: 'explorbot | "$(Build.BuildId)"'
      restoreKeys: 'explorbot'
      path: experience
  - task: Cache@2
    inputs:
      key: 'explorbot-output | "$(Build.BuildId)"'
      restoreKeys: 'explorbot-output'
      path: output
  - script: |
      npm ci
      npx playwright install --with-deps chromium
      npx explorbot explore / --max-tests 10 --session
    timeoutInMinutes: 60
    env:
      OPENROUTER_API_KEY: $(OPENROUTER_API_KEY)
  - task: PublishPipelineArtifact@1
    condition: always()
    inputs:
      targetPath: output/reports
      artifact: explorbot-reports
```
