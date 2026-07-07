export async function run(cmd: string[], opts: RunOptions = {}): Promise<RunResult> {
  const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: opts.stderr ?? 'pipe', cwd: opts.cwd, env: opts.env });
  const stdout = await new Response(proc.stdout).text();
  let stderr = '';
  if (opts.stderr !== 'ignore') stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  return { code, stdout, stderr };
}

interface RunOptions {
  stderr?: 'pipe' | 'ignore';
  cwd?: string;
  env?: Record<string, string | undefined>;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}
