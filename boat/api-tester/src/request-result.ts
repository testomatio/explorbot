import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export class RequestResult {
  id: string;
  method: string;
  path: string;
  fullUrl: string;
  requestHeaders: Record<string, string>;
  requestBody?: any;
  status: number;
  statusText: string;
  responseHeaders: Record<string, string>;
  timing: number;
  timestamp: Date;
  error?: string;

  requestFile = '';
  responseFile = '';

  private _rawResponseBody?: string;

  constructor(opts: {
    id: string;
    method: string;
    path: string;
    fullUrl: string;
    requestHeaders: Record<string, string>;
    requestBody?: any;
    status: number;
    statusText: string;
    responseHeaders: Record<string, string>;
    timing: number;
    timestamp: Date;
    error?: string;
  }) {
    this.id = opts.id;
    this.method = opts.method;
    this.path = opts.path;
    this.fullUrl = opts.fullUrl;
    this.requestHeaders = opts.requestHeaders;
    this.requestBody = opts.requestBody;
    this.status = opts.status;
    this.statusText = opts.statusText;
    this.responseHeaders = opts.responseHeaders;
    this.timing = opts.timing;
    this.timestamp = opts.timestamp;
    this.error = opts.error;
  }

  get rawResponseBody(): string {
    if (this._rawResponseBody !== undefined) return this._rawResponseBody;
    if (this.responseFile && existsSync(this.responseFile)) {
      this._rawResponseBody = readFileSync(this.responseFile, 'utf8');
      return this._rawResponseBody;
    }
    return '';
  }

  set rawResponseBodyValue(value: string) {
    this._rawResponseBody = value;
  }

  get responseBody(): any {
    const raw = this.rawResponseBody;
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  save(outputDir: string): void {
    const requestsDir = path.join(outputDir, 'requests');
    if (!existsSync(requestsDir)) {
      mkdirSync(requestsDir, { recursive: true });
    }

    this.requestFile = path.join(requestsDir, `${this.id}.request.yaml`);
    this.responseFile = path.join(requestsDir, `${this.id}.response.json`);

    const headerLines = Object.entries(this.requestHeaders)
      .map(([k, v]) => `  ${k}: ${v}`)
      .join('\n');

    const responseHeaderLines = Object.entries(this.responseHeaders)
      .map(([k, v]) => `  ${k}: ${v}`)
      .join('\n');

    let yaml = '---\n';
    yaml += `method: ${this.method}\n`;
    yaml += `url: ${this.path}\n`;
    yaml += `fullUrl: ${this.fullUrl}\n`;
    yaml += `headers:\n${headerLines}\n`;
    yaml += `status: ${this.status}\n`;
    yaml += `statusText: ${this.statusText}\n`;
    yaml += `responseHeaders:\n${responseHeaderLines}\n`;
    yaml += `timing: ${this.timing}\n`;
    yaml += `timestamp: ${this.timestamp.toISOString()}\n`;
    yaml += '---\n';

    if (this.requestBody) {
      const body = typeof this.requestBody === 'string' ? this.requestBody : JSON.stringify(this.requestBody, null, 2);
      yaml += body;
    }

    writeFileSync(this.requestFile, yaml, 'utf8');
    writeFileSync(this.responseFile, this._rawResponseBody || '', 'utf8');
  }

  static load(requestFile: string): RequestResult {
    const content = readFileSync(requestFile, 'utf8');
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!frontmatterMatch) throw new Error(`Invalid request file: ${requestFile}`);

    const meta: Record<string, any> = {};
    const lines = frontmatterMatch[1].split('\n');
    let currentKey = '';
    let currentObj: Record<string, string> | null = null;

    for (const line of lines) {
      const indentedMatch = line.match(/^ {2}(\S+):\s*(.*)$/);
      if (indentedMatch && currentObj) {
        currentObj[indentedMatch[1]] = indentedMatch[2];
        continue;
      }

      const kvMatch = line.match(/^(\S+):\s*(.*)$/);
      if (!kvMatch) continue;

      currentKey = kvMatch[1];
      const value = kvMatch[2];

      if (!value) {
        currentObj = {};
        meta[currentKey] = currentObj;
      } else {
        currentObj = null;
        meta[currentKey] = value;
      }
    }

    const id = path.basename(requestFile).replace('.request.yaml', '');
    const responseFile = requestFile.replace('.request.yaml', '.response.json');

    const result = new RequestResult({
      id,
      method: meta.method || 'GET',
      path: meta.url || '',
      fullUrl: meta.fullUrl || '',
      requestHeaders: meta.headers || {},
      requestBody: frontmatterMatch[2] || undefined,
      status: Number.parseInt(meta.status) || 0,
      statusText: meta.statusText || '',
      responseHeaders: meta.responseHeaders || {},
      timing: Number.parseInt(meta.timing) || 0,
      timestamp: new Date(meta.timestamp || Date.now()),
    });

    result.requestFile = requestFile;
    result.responseFile = responseFile;

    return result;
  }

  toSummary(): string {
    return `${this.method} ${this.path} → ${this.status} (${this.timing}ms)`;
  }

  toCurlCommand(): string {
    let cmd = `curl -X ${this.method} '${this.fullUrl}'`;
    for (const [k, v] of Object.entries(this.requestHeaders)) {
      cmd += ` -H '${k}: ${v}'`;
    }
    if (this.requestBody) {
      const body = typeof this.requestBody === 'string' ? this.requestBody : JSON.stringify(this.requestBody);
      cmd += ` -d '${body}'`;
    }
    return cmd;
  }
}
