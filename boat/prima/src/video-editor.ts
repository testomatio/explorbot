import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const DROP_STALE_FRAMES = 'mpdecimate=hi=64*48:lo=64*24:frac=0.5';
const STILL_HOLD_SECONDS = 1;
const FPS = 25;

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
      const chains = used.map((clip, index) => `[${index}:v]${this.clipFilter(clip, size, path.join(workDir, `${index}.txt`))}[v${index}]`);
      const joined = used.map((_, index) => `[v${index}]`).join('');
      const graph = `${chains.join(';')};${joined}concat=n=${used.length}:v=1:a=0,tpad=stop_mode=clone:stop_duration=${STILL_HOLD_SECONDS}[out]`;

      mkdirSync(path.dirname(output), { recursive: true });
      this.ffmpeg([...used.flatMap((clip) => ['-i', clip.file]), '-filter_complex', graph, '-map', '[out]', '-c:v', 'libvpx', '-crf', '10', '-b:v', '2M', output]);
      return { used, still };
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }

  private clipFilter(clip: VideoClip, size: { width: number; height: number }, captionFile: string): string {
    const { width, height } = size;
    const filters = [`scale=${width}:${height}:force_original_aspect_ratio=decrease`, `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`, 'setsar=1', `fps=${FPS}`, DROP_STALE_FRAMES, `setpts='if(eq(N\\,0)\\,0\\,PREV_OUTPTS+min(PTS-PREV_INPTS\\,${STILL_HOLD_SECONDS}/TB))'`];
    if (clip.speed) filters.push(`setpts=PTS/${clip.speed}`);
    filters.push(`fps=${FPS}`);
    if (clip.hold) filters.push(`tpad=stop_mode=clone:stop_duration=${clip.hold}`);
    if (clip.caption) {
      writeFileSync(captionFile, clip.caption, 'utf-8');
      filters.push(`drawtext=textfile='${captionFile}':fontsize=h/22:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=14:x=(w-text_w)/2:y=h-text_h-h/12`);
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
}
