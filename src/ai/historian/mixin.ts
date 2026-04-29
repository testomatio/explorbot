import { createDebug } from '../../utils/logger.js';

export type Constructor<T = object> = new (...args: any[]) => T;
export const debugLog = createDebug('explorbot:historian');
