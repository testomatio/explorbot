import stripAnsi from 'strip-ansi';

export async function withCleanReporterConsole<T>(fn: () => Promise<T>): Promise<T> {
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = (...args: any[]) => {
    const line = cleanReporterLine(args);
    if (!line) return;
    originalLog.apply(console, [line]);
  };
  console.warn = (...args: any[]) => {
    const line = cleanReporterLine(args);
    if (!line) return;
    originalWarn.apply(console, [line]);
  };
  try {
    return await fn();
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }
}

export function cleanReporterLine(args: any[]): string | null {
  const text = stripAnsiText(args.map((arg) => String(arg)).join(' '));
  if (text.includes('Testomatio Reporter v')) return null;
  if (text.includes('Report created. Report ID:')) return null;
  if (text.includes('will be added to the HTML report')) return null;
  if (text.includes('will be added to the Markdown report')) return null;
  if (text.includes('Pipes:')) return null;

  const htmlMatch = text.match(/HTML report was successfully generated\. Full filepath:\s*(.+)$/);
  if (htmlMatch) return `HTML report: ${htmlMatch[1]}`;

  const markdownMatch = text.match(/Markdown report was successfully generated\. Full filepath:\s*(.+)$/);
  if (markdownMatch) return `Markdown report: ${markdownMatch[1]}`;

  const reportUrlMatch = text.match(/Report URL:\s*(.+)$/);
  if (reportUrlMatch) return `Testomat.io report: ${reportUrlMatch[1]}`;

  return text;
}

function stripAnsiText(text: string): string {
  return stripAnsi(text).trim();
}
