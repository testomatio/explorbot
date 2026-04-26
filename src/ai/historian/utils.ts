import type { ToolExecution } from '../conversation.ts';

export function isNonReusableCode(code: string): boolean {
  return /\bI\.clickXY\s*\(/.test(code);
}

export function escapeString(str: string): string {
  return str.replace(/'/g, "\\'").replace(/\n/g, ' ');
}

export function stripComments(code: string): string {
  return code
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('/*') && !trimmed.startsWith('*');
    })
    .join('\n');
}

export function getExecutionLabel(exec: ToolExecution, fallback?: string): string {
  return exec.input?.explanation || exec.input?.assertion || exec.input?.note || fallback || '';
}
