import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium, firefox, webkit } from 'playwright-core';
import { ConfigParser } from './config.js';
import { log, tag } from './utils/logger.js';

const ENDPOINT_FILENAME = '.browser-endpoint';

function getEndpointFilePath(): string {
  const configParser = ConfigParser.getInstance();
  const outputDir = configParser.getOutputDir();
  return path.join(outputDir, ENDPOINT_FILENAME);
}

function readEndpoint(): string | null {
  const filePath = getEndpointFilePath();
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, 'utf8').trim();
}

function writeEndpoint(wsEndpoint: string): void {
  const filePath = getEndpointFilePath();
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, wsEndpoint, 'utf8');
}

function removeEndpointFile(): void {
  const filePath = getEndpointFilePath();
  if (existsSync(filePath)) unlinkSync(filePath);
}

async function isServerRunning(wsEndpoint: string): Promise<boolean> {
  try {
    const browser = await chromium.connect(wsEndpoint, { timeout: 3000 });
    await browser.close();
    return true;
  } catch {
    return false;
  }
}

const BROWSER_LAUNCHERS = { chromium, firefox, webkit } as const;

async function launchServer(opts: { browser?: string; show?: boolean }): Promise<any> {
  const browserName = (opts.browser || 'chromium') as keyof typeof BROWSER_LAUNCHERS;
  const launcher = BROWSER_LAUNCHERS[browserName];
  if (!launcher) throw new Error(`Unsupported browser: ${browserName}`);

  const server = await launcher.launchServer({
    headless: !opts.show,
  });

  const wsEndpoint = server.wsEndpoint();
  writeEndpoint(wsEndpoint);

  log(`Browser server started: ${browserName} (${opts.show ? 'headed' : 'headless'})`);
  tag('info').log(`WebSocket endpoint: ${wsEndpoint}`);
  tag('info').log(`Endpoint saved to: ${getEndpointFilePath()}`);

  return server;
}

async function getAliveEndpoint(): Promise<string | null> {
  const endpoint = readEndpoint();
  if (!endpoint) return null;
  if (await isServerRunning(endpoint)) return endpoint;
  removeEndpointFile();
  return null;
}

export { readEndpoint, removeEndpointFile, isServerRunning, launchServer, getEndpointFilePath, getAliveEndpoint };
