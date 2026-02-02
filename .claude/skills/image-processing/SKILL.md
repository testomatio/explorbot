---
name: image-processing
description: Process images for documentation - add borders/shadows to screenshots, create GIFs from videos. Use when preparing visual assets.
---

# Image Processing

Commands for processing images and videos for documentation.

## Add Border and Shadow to Screenshot

```bash
convert input.png \
  -bordercolor '#e0e0e0' -border 1 \
  \( +clone -background '#00000040' -shadow 80x8+4+4 \) \
  +swap -background white -layers merge +repage \
  output.png
```

Parameters:
- `-border 1` — thin gray border
- `-shadow 80x8+4+4` — 80% opacity, 8px blur, 4px offset

## Create GIF from Video

```bash
ffmpeg -ss 0:44 -to 0:54 -i input.mp4 \
  -vf "fps=10,scale=800:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" \
  -loop 0 output.gif
```

Parameters:
- `-ss 0:44 -to 0:54` — start/end timestamps
- `fps=10` — frames per second
- `scale=800:-1` — width 800px, auto height

## Utilities

```bash
# Check dimensions
identify -format "%wx%h\n" image.png

# Check video duration
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 video.mp4

# Resize image
convert input.png -resize 800x output.png
```
