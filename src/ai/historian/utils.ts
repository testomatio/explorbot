import type { ToolExecution } from '../conversation.ts';
export { isNonReusableCode, stripComments } from '../../utils/step-analyzer.ts';

export function escapeString(str: string): string {
  return str.replace(/'/g, "\\'").replace(/\n/g, ' ');
}

export function getExecutionLabel(exec: ToolExecution, fallback?: string): string {
  return exec.input?.explanation || exec.input?.assertion || exec.input?.note || fallback || '';
}
