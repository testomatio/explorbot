const FUNCTION_SHAPE = /^(async\s+)?(function\b|\()/;

export function isFunctionExpression(expr: string): { valid: boolean; error?: string } {
  const trimmed = expr.trim();
  if (!trimmed) return { valid: false, error: 'empty expression; pass a function like ({ page }) => ...' };
  if (!FUNCTION_SHAPE.test(trimmed)) return { valid: false, error: 'expression must be a function like ({ page }) => ... destructuring the playwright objects it needs' };
  try {
    new Function(`return (${trimmed})`);
  } catch (e) {
    return { valid: false, error: `not a valid function expression: ${(e as Error).message}` };
  }
  return { valid: true };
}

export function toCodeceptWrapper(expr: string): string {
  return `I.usePlaywrightTo('pw', async (playwright) => (${expr.trim()})(playwright))`;
}
