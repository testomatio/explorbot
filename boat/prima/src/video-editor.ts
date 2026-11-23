import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const DROP_STALE_FRAMES = 'mpdecimate=hi=64*48:lo=64*24:frac=0.5';
const STILL_HOLD_SECONDS = 1;
const FPS = 25;
const MIN_SEGMENT_SECONDS = 0.05;

export class VideoEditor {
  static requireFfmpeg(): void {
    if (!spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).error) return;
    throw new Error('Video needs ffmpeg on PATH. Install it (apt install ffmpeg, brew install ffmpeg, winget install ffmpeg) and run again.');
  }

  render(clips: VideoClip[], output: string): { used: VideoClip[]; still: VideoClip[] } {
    VideoEditor.requireFfmpeg();
    const used = clips.filter((clip) => this.distinctFrames(clip.file) > 1);
    const still = clips.filter((clip) => !used.includes(clip));
    if (!used.length) return { used, still };

    const workDir = mkdtempSync(path.join(tmpdir(), 'prima-video-'));
    try {
      const size = this.frameSize(used[0].file);
      const chains: string[] = [];
      const joined: string[] = [];
      used.forEach((clip, index) => {
        const segments = (clip.segments || []).filter((segment) => segment.end - segment.start >= MIN_SEGMENT_SECONDS);
        if (!segments.length) {
          chains.push(`[${index}:v]${this.clipFilter(clip, size, path.join(workDir, `${index}`), null, true)}[v${index}]`);
          joined.push(`[v${index}]`);
          return;
        }
        const labels = segments.map((_, part) => `s${index}_${part}`);
        chains.push(`[${index}:v]split=${segments.length}${labels.map((label) => `[${label}]`).join('')}`);
        segments.forEach((segment, part) => {
          chains.push(`[${labels[part]}]${this.clipFilter(clip, size, path.join(workDir, `${index}-${part}`), segment, part === segments.length - 1)}[v${labels[part]}]`);
          joined.push(`[v${labels[part]}]`);
        });
      });
      const graph = `${chains.join(';')};${joined.join('')}concat=n=${joined.length}:v=1:a=0,tpad=stop_mode=clone:stop_duration=${STILL_HOLD_SECONDS}[out]`;

      mkdirSync(path.dirname(output), { recursive: true });
      this.ffmpeg([...used.flatMap((clip) => ['-i', clip.file]), '-filter_complex', graph, '-map', '[out]', '-c:v', 'libvpx', '-crf', '10', '-b:v', '2M', output]);
      return { used, still };
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }

  private clipFilter(clip: VideoClip, size: { width: number; height: number }, textBase: string, segment: VideoSegment | null, last: boolean): string {
    const { width, height } = size;
    const filters: string[] = [];
    let speed = clip.speed || 1;
    if (segment) {
      filters.push(`trim=start=${segment.start}:end=${segment.end}`, 'setpts=PTS-STARTPTS');
      const length = segment.end - segment.start;
      if (clip.stepTime && length > clip.stepTime) speed *= length / clip.stepTime;
    }
    filters.push(`scale=${width}:${height}:force_original_aspect_ratio=decrease`, `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`, 'setsar=1', `fps=${FPS}`, DROP_STALE_FRAMES, `setpts='if(eq(N\\,0)\\,0\\,PREV_OUTPTS+min(PTS-PREV_INPTS\\,${STILL_HOLD_SECONDS}/TB))'`);
    if (speed !== 1) filters.push(`setpts=PTS/${speed}`);
    filters.push(`fps=${FPS}`);
    if (last && clip.hold) filters.push(`tpad=stop_mode=clone:stop_duration=${clip.hold}`);
    let color = 'black@0.75';
    if (segment?.alert) color = '0xB00020@0.85';
    segment?.overlay?.forEach((line, index) => {
      writeFileSync(`${textBase}-overlay-${index}.txt`, line, 'utf-8');
      filters.push(`drawtext=textfile='${textBase}-overlay-${index}.txt':expansion=none:fontsize=h/36:fontcolor=white:box=1:boxcolor=${color}:boxborderw=8:x=w/40:y=h/40+${index}*h/22`);
    });
    if (clip.caption) {
      writeFileSync(`${textBase}-caption.txt`, clip.caption, 'utf-8');
      filters.push(`drawtext=textfile='${textBase}-caption.txt':expansion=none:fontsize=h/22:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=14:x=(w-text_w)/2:y=h-text_h-h/12`);
    }
    return filters.join(',');
  }

  private distinctFrames(file: string): number {
    const frames = this.ffmpeg(['-i', file, '-an', '-vf', DROP_STALE_FRAMES, '-f', 'framemd5', '-']);
    return frames.split('\n').filter((line) => line.trim() && !line.startsWith('#')).length;
  }

  private frameSize(file: string): { width: number; height: number } {
    const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', file], { encoding: 'utf-8' });
    const [stream] = JSON.parse(probe.stdout || '{}').streams || [];
    if (!stream) throw new Error(`ffprobe could not read the video size of ${file}`);
    return { width: stream.width, height: stream.height };
  }

  private ffmpeg(args: string[]): string {
    const run = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
    if (run.status === 0) return run.stdout;
    throw new Error(`ffmpeg failed: ${run.stderr || run.error?.message}`);
  }
}

export interface VideoClip {
  number: string;
  title: string;
  file: string;
  caption?: string;
  speed?: number;
  hold?: number;
  stepTime?: number;
  segments?: VideoSegment[];
}

export interface VideoSegment {
  start: number;
  end: number;
  overlay?: string[];
  alert?: boolean;
}
