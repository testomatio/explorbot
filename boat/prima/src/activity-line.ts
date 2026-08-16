import chalk from 'chalk';
import { type ActivityEntry, addActivityListener, removeActivityListener } from '../../../src/activity.ts';
import { isVerboseMode } from '../../../src/utils/logger.ts';

const RESET_LINE = '\r\u001b[2K';

const stream = process.stderr;
let tracking = false;

export function trackActivityLine(): void {
  if (tracking) return;
  if (!stream.isTTY) return;
  if (isVerboseMode()) return;

  tracking = true;
  addActivityListener(writeActivityLine);
}

export function clearActivityLine(): void {
  if (!tracking) return;

  tracking = false;
  removeActivityListener(writeActivityLine);
  stream.write(RESET_LINE);
}

function writeActivityLine(activity: ActivityEntry | null): void {
  if (!activity) return;

  const width = (stream.columns || 80) - 2;
  const message = Array.from(activity.message.replace(/\s+/g, ' ').trim()).slice(0, width).join('');
  stream.write(`${RESET_LINE}${chalk.gray(message)}`);
}
