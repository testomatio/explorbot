import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium, firefox, webkit } from 'playwright-core';
import { ConfigParser } from './config.js';
import { getCliName } from './utils/cli-name.ts';
import { log } from './utils/logger.js';
import { type NextStepSection, printNextSteps } from './utils/next-steps.ts';

const ENDPOINT_FILENAME = '.browser-endpoint';
const INSTANCE_NAME_PATTERN = /^[a-z0-9-]+$/;

function getEndpointFilePath(instance = 'default'): string {
  if (!INSTANCE_NAME_PATTERN.test(instance)) {
    throw new Error(`Invalid browser instance name: "${instance}". Use lowercase letters, digits and dashes.`);
  }
  const configParser = ConfigParser.getInstance();
  const outputDir = configParser.getOutputDir();
  if (instance === 'default') return path.join(outputDir, ENDPOINT_FILENAME);
  return path.join(outputDir, `${ENDPOINT_FILENAME}-${instance}`);
}

function readEndpoint(instance = 'default'): string | null {
  const filePath = getEndpointFilePath(instance);
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, 'utf8').trim();
}

function writeEndpoint(wsEndpoint: string, instance = 'default'): void {
  const filePath = getEndpointFilePath(instance);
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, wsEndpoint, 'utf8');
}

function removeEndpointFile(instance = 'default'): void {
  const filePath = getEndpointFilePath(instance);
  if (existsSync(filePath)) unlinkSync(filePath);
}

function listInstances(): Array<{ name: string; endpoint: string }> {
  const dir = path.dirname(getEndpointFilePath());
  if (!existsSync(dir)) return [];

  const instances: Array<{ name: string; endpoint: string }> = [];
  for (const fileName of readdirSync(dir)) {
    if (!fileName.startsWith(ENDPOINT_FILENAME)) continue;
    const suffix = fileName.slice(ENDPOINT_FILENAME.length);
    if (suffix && !suffix.startsWith('-')) continue;
    if (suffix === '-') continue;
    const name = suffix.slice(1) || 'default';
    if (!INSTANCE_NAME_PATTERN.test(name)) continue;
    instances.push({ name, endpoint: readFileSync(path.join(dir, fileName), 'utf8').trim() });
  }
  return instances;
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

async function launchServer(opts: { browser?: string; show?: boolean }, instance = 'default'): Promise<any> {
  const browserName = (opts.browser || 'chromium') as keyof typeof BROWSER_LAUNCHERS;
  const launcher = BROWSER_LAUNCHERS[browserName];
  if (!launcher) throw new Error(`Unsupported browser: ${browserName}`);

  const server = await launcher.launchServer({
    headless: !opts.show,
  });

  const wsEndpoint = server.wsEndpoint();
  writeEndpoint(wsEndpoint, instance);

  log(`Browser server started: ${browserName} (${opts.show ? 'headed' : 'headless'})`);

  const cli = getCliName();
  let instanceFlag = '';
  if (instance !== 'default') instanceFlag = ` --instance ${instance}`;
  const sections: NextStepSection[] = [
    {
      label: 'Browser server',
      path: getEndpointFilePath(instance),
      commands: [
        { label: 'Endpoint', command: wsEndpoint },
        { label: 'Status', command: `${cli} browser status${instanceFlag}` },
        { label: 'Stop', command: `${cli} browser stop${instanceFlag}` },
      ],
    },
  ];
  printNextSteps(sections);

  return server;
}

async function getAliveEndpoint(instance = 'default'): Promise<string | null> {
  const endpoint = readEndpoint(instance);
  if (!endpoint) return null;
  if (await isServerRunning(endpoint)) return endpoint;
  removeEndpointFile(instance);
  return null;
}

export { readEndpoint, removeEndpointFile, isServerRunning, launchServer, getEndpointFilePath, getAliveEndpoint, listInstances };
