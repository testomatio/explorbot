import path from 'node:path';

let cached: string | undefined;

export function getCliName(): string {
  if (cached) return cached;
  const ua = process.env.npm_config_user_agent || '';
  if (ua.includes('bun')) cached = 'bunx explorbot';
  else if (ua.includes('npm')) cached = 'npx explorbot';
  else if (process.argv[1]?.endsWith('.ts')) cached = `bun ${path.relative(process.cwd(), process.argv[1])}`;
  else cached = 'explorbot';
  return cached;
}
