import type { SessionStep } from '../experience-tracker.ts';
import type { StepData } from '../test-plan.ts';
import { isDynamicId } from './xpath.ts';

export const CODECEPT_TOOLS = ['click', 'hover', 'pressKey', 'form'] as const;
export type CodeceptToolName = (typeof CODECEPT_TOOLS)[number];

const CODECEPT_FORM_COMMANDS: readonly string[] = ['I.fillField', 'I.type', 'I.selectOption', 'I.attachFile', 'I.checkOption', 'I.uncheckOption'];

export function isCodeceptToolName(toolName: string): toolName is CodeceptToolName {
  return CODECEPT_TOOLS.includes(toolName as CodeceptToolName);
}

export function getCodeceptToolName(commandName: string): CodeceptToolName | null {
  const toolName = CODECEPT_TOOLS.find((name) => commandName === `I.${name}`);
  if (toolName) return toolName;
  if (CODECEPT_FORM_COMMANDS.includes(commandName)) return 'form';
  return null;
}

export function getCodeceptToolNameFromCode(code: string): CodeceptToolName | null {
  const parenIndex = code.trim().indexOf('(');
  if (parenIndex < 1) return null;
  return getCodeceptToolName(code.trim().slice(0, parenIndex));
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

export function isNonReusableCode(code: string): boolean {
  if (/\bI\.clickXY\s*\(/.test(code)) return true;

  for (const m of code.matchAll(/#([A-Za-z_][\w-]*)/g)) {
    if (isDynamicId(m[1])) return true;
  }

  return false;
}

export function toReusableSessionStep(step: StepData): SessionStep | null {
  if (step.status !== 'passed') return null;
  const code = stripComments(step.text);
  if (!code || isNonReusableCode(code)) return null;
  const toolName = getCodeceptToolNameFromCode(code);
  if (!toolName) return null;

  return {
    message: step.text,
    status: 'passed',
    tool: toolName,
    code,
  };
}

export function mergeUniqueStepsByCode(primary: SessionStep[], secondary: SessionStep[]): SessionStep[] {
  const merged: SessionStep[] = [];
  const seen = new Set<string>();
  for (const step of [...primary, ...secondary]) {
    const identity = stripComments(step.code || '').trim();
    if (!identity) continue;
    if (seen.has(identity)) continue;
    seen.add(identity);
    merged.push(step);
  }
  return merged;
}
