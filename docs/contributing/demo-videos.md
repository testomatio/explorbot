# Demo Videos

Explorbot sessions can be turned into demo videos for social media and presentations. The generator composites the browser screencast of a test with a simulated terminal that replays the session's real log lines at their original pace, over an abstract background with window chrome and shadows. Everything shown is real recorded data: no more than 1.25x speedup, successful runs only.

Implementation lives in `.claude/skills/demo-video/` (`demo-video.ts` exports `analyzeDemoCandidates` and `createDemoVideo`; the Bunoshfile wraps them as commands).

## Prerequisites

- `vhs` and `ttyd` — render the terminal simulation (`go install github.com/charmbracelet/vhs@latest`)
- `ffmpeg` and ImageMagick
- IBM Plex Mono font (optional — VHS falls back to its default mono font)
- A session recorded with screencasts: enable `ai.agents.historian.screencast` in `explorbot.config.js` so `output/screencasts/*.webm` exist alongside `output/explorbot.log`

## Usage

```bash
bunx bunosh demo:analyze output/explorbot.log --screencasts output/screencasts
bunx bunosh demo:video --size landscape --app-title "My App"
bunx bunosh demo:video "upload a file" --size vertical --terminal-theme light
```

`demo:analyze` lists candidate segments ranked by how well they will read on video. `demo:video` renders the best one, or the test whose scenario name matches the first argument. Key options: `--duration` (target seconds, default 30), `--size` (`landscape`, `square`, `vertical`, or `WxH`), `--app-title` (browser window title, defaults to the tested app's host), `--terminal-theme` (`dark` or `light`), `--bg-image` (`auto` fetches a random abstract photo from Unsplash, `gradient` generates one offline, or pass a file/URL). Run `bunx bunosh demo:video --help` for the full list.

The renderer verifies its output and writes three check frames (`*-frame-first/mid/last.png`) next to the video — review them before publishing.

## How segments are picked

Only successful tests with an existing screencast qualify. Within a test, the scorer prefers windows that:

- are dense in visible actions (click, fill, type, navigate) rather than thinking or verification steps
- have no dead air — inter-step gaps stay under 10 seconds
- show forward progress — windows dominated by repeated retry steps are rejected
- were executed live — batch-logged step bursts cannot sync with the video and are rejected
- do not end on a failure note or mid-navigation on a blank page

The log's `Saved screencast:` line joins a test to its `.webm`; video time is calibrated from that timestamp minus the video duration. If a screencast file was overwritten by a run outside the log, it is skipped.
