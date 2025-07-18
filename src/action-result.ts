import { minifyHtml, removeNonInteractiveElements } from 'codeceptjs/lib/html';

interface ActionResultData {
  html: string;
  url: string;
  screenshot?: Buffer;
  title?: string;
  timestamp?: Date;
  error?: string | null;
  h1?: string;
  h2?: string;
  h3?: string;
  h4?: string;
}

export class ActionResult {
  public html: string;
  public readonly screenshot: Buffer | null;
  public readonly title: string;
  public readonly error: string | null;
  public readonly timestamp: Date;
  public readonly h1: string | null;
  public readonly h2: string | null;
  public readonly h3: string | null;
  public readonly h4: string | null;
  public readonly url: string | null;

  constructor(data: ActionResultData) {
    Object.assign(this, {
      timestamp: new Date(),
      ...data,
    });
  }

  async getSimplifiedHtml(): Promise<string> {
    const processedHtml = removeNonInteractiveElements(this.html);
    return await minifyHtml(processedHtml);
  }

  async simplify(): Promise<void> {
    const processedHtml = removeNonInteractiveElements(this.html);
    this.html = await minifyHtml(processedHtml);
  }

  toAiContext(): string {
    const excludedKeys = ['html', 'error', 'timestamp', 'screenshot'];
    const contextParts: string[] = [];

    for (const [key, value] of Object.entries(this)) {
      if (
        !excludedKeys.includes(key) &&
        value !== null &&
        value !== undefined
      ) {
        contextParts.push(`<${key}>${value}</${key}>`);
      }
    }

    return contextParts.join('\n');
  }

  get relativeUrl(): string | null {
    if (!this.url) return null;
    
    const urlObj = new URL(this.url);
    const path = urlObj.pathname.replace(/\/$/, '') || '/';
    const hash = urlObj.hash || '';
    
    return path + hash;
  }

  getStateHash(): string {
    const parts: string[] = [];

    parts.push(this.relativeUrl || '/');

    const headings = ['h1', 'h2'];

    for (const heading of headings) {
      const value = this[heading as keyof this] as string;
      if (value) {
        parts.push(`${heading}_${value}`);
      }
    }

    let stateString = parts
      .map((part) => part.substring(0, 100))
      .join('_')
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .toLowerCase();

    if (stateString.length > 200) {
      stateString = stateString.substring(0, 200);
      if (stateString.endsWith('_')) {
        stateString = stateString.slice(0, -1);
      }
    }

    return stateString;
  }
}
