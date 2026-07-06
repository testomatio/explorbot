---
name: demo-video
description: Produce demo videos of Explorbot runs for social media and presentations — composites the real browser screencast with a simulated terminal replaying real log lines in near real time. Use when asked to create a demo video, promo clip, or presentation video of an Explorbot session.
---

# Demo Video

Generates a polished MP4 from a finished Explorbot session: the browser screencast (`output/screencasts/*.webm`) plays in a large panel while a simulated dark terminal replays the matching `explorbot.log` lines with their original timing. Only successful tests are used, playback is sped up at most 1.25x, and everything shown is real recorded data.

## Requirements

- `vhs` (Charm) — renders the terminal simulation. Install: `go install github.com/charmbracelet/vhs@latest` (also needs `ttyd`)
- `ffmpeg` / `ffprobe` and ImageMagick (`magick`)
- `bun`
- IBM Plex Mono font (optional — VHS falls back to its default mono font if missing)

## Workflow

1. Run `analyze` to list candidate segments (successful tests ranked by visual action density):

```bash
bun .claude/skills/demo-video/demo-video.ts analyze \
  --log output/explorbot.log --screencasts output/screencasts --duration 30
```

2. Show the user the top candidates and confirm scenario, duration, and size — or skip straight to `auto` which picks the best one.

3. Render:

```bash
bun .claude/skills/demo-video/demo-video.ts auto \
  --log output/explorbot.log --screencasts output/screencasts \
  --duration 30 --size landscape --output output/demo.mp4
```

Or render a specific test / window:

```bash
bun .claude/skills/demo-video/demo-video.ts render \
  --log output/explorbot.log --screencasts output/screencasts \
  --screencast <file.webm> \
  --start 155 --end 190 \
  --duration 30 --size vertical --output output/demo.mp4
```

4. The renderer writes `<output>-frame-first.png`, `-mid.png`, `-last.png` next to the video. Read all three and confirm: browser content visible and uncropped, terminal text readable, layout correct, and the mid-frame terminal lines plausibly match mid-segment browser activity. Then present the output path to the user.

## CLI reference

Parameters:

- `--log` — path to explorbot.log (default `output/explorbot.log`)
- `--screencasts` — directory with `.webm` screencasts (default `output/screencasts`)
- `--duration` — target video length in seconds (default 30); output may be shorter if the test is short
- `--size` — `landscape` (1920x1080), `vertical` (1080x1920), `square` (1080x1080), or any `WxH`
- `--output` — output MP4 path (default `output/demo-<test>-<WxH>.mp4`)
- `--screencast` — pick a test by webm filename (render only)
- `--scenario` — pick a test by scenario name substring (render only)
- `--start` / `--end` — explicit window: seconds into the video, or ISO timestamps from the log (render only)
- `--speed-max` — playback speedup cap (default 1.25, never slows down)
- `--bg-image` — canvas backdrop: `auto` (default — random abstract photo from Unsplash, falls back to a generated gradient offline), `gradient` (generated abstract gradient), `none` (flat `--bg` color), a local file path, or an image URL
- `--bg` — flat canvas color used with `--bg-image none` (default `#F2F0EB`)
- `--app-title` — text for the browser window title bar (defaults to the tested app's host parsed from the log)
- `--terminal-theme` — `dark` (default) or `light` terminal appearance
- `--success-epilogue` — if the window doesn't reach the test end, append the real green success line near the end
- `--keep-temp` — keep the temp workspace (tape, replay script, terminal render) for debugging
- `--json` — machine-readable `analyze` output

## Layouts

| Size class | Composition |
|---|---|
| wide (W/H ≥ 1.4) | browser window centered-right, terminal bottom-left sitting mostly (~80%) on top of it, soft shadows |
| square (0.8–1.4) | browser top-centered, terminal bottom-left mostly over it |
| tall (W/H ≤ 0.8) | horizontal split: browser band full-width on top, terminal fills the rest below, no overlap |

Wide canvases are cropped left/right so side margins never exceed 5% of the frame — the actual output width can be smaller than requested (height is kept). Both windows have rounded corners and drop shadows; the browser gets a drawn title bar (traffic lights + scenario name); the terminal is 70% opaque so the backdrop shows through. Duplicate step lines in the log are suppressed the same way Explorbot's live console does it (repeated `I.` command within 15s).

## How timing works

- The webm timeline is calibrated from the log: video start = `Saved screencast:` line timestamp minus ffprobe duration.
- Segment selection prefers windows dense in visible actions (click/fill/type/navigate), inter-step gaps ≤ 10s with at most one gap near 10s; if nothing qualifies it relaxes limits stepwise and tags the result with a relax level.
- Segments must show forward progress: windows where fewer than 60% of steps are unique (retry loops) or whose final seconds contain warning/error notes are rejected; success notes and passing Pilot reviews inside the window raise the score, failure notes lower it.
- `speed = clamp(segment/target, 1.0, 1.25)` is applied identically to the browser video (`setpts`) and the terminal replay delays, so both stay in sync.
- The terminal replay schedules each line at its absolute offset, so print latency never accumulates; a 0.8s startup pad is trimmed during compositing.

## Troubleshooting

- **No candidates** — only successful tests with an existing webm ≥ 10s qualify. Check `Saved screencast:` and `Successful test:` lines exist in the log; use `--start`/`--end` to force a window.
- **Log/screencast mismatch** — screencast files are overwritten on re-run; only the last `Saved screencast:` occurrence per file matches the file on disk. A `scenario name does not match webm filename` warning means the join is suspect.
- **VHS parse errors** — VHS tapes cannot contain long absolute `Output` paths; the tool always runs VHS with `cwd` set to the temp dir and a relative output. Use `--keep-temp` and re-run `vhs demo.tape` there to debug.
- **Terminal drift warning** — if the VHS render duration deviates >1.5s from expected, a corrective `setpts` is applied automatically; the composite is also padded/trimmed so it cannot desync the cut.

## Manual recipes

Extract a check frame:

```bash
ffmpeg -y -ss 15 -i output/demo.mp4 -frames:v 1 frame.png
```

Parameters:

- `-ss` — seek position in seconds
- `-frames:v 1` — extract a single frame

Probe any video's size and duration:

```bash
ffprobe -v error -select_streams v:0 \
  -show_entries stream=width,height -show_entries format=duration \
  -of default=noprint_wrappers=1 input.webm
```
