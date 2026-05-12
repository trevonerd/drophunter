const LOG_PREFIX = '[DropHunter]';
const DEBUG_LOGS_ENABLED = typeof __DROPHUNTER_DEBUG_LOGS__ === 'boolean' ? __DROPHUNTER_DEBUG_LOGS__ : false;

export function logContentDebug(...args: unknown[]) {
  if (DEBUG_LOGS_ENABLED) {
    console.debug(LOG_PREFIX, ...args);
  }
}

export function logContentInfo(...args: unknown[]) {
  if (DEBUG_LOGS_ENABLED) {
    console.info(LOG_PREFIX, ...args);
  }
}

export function logContentWarn(...args: unknown[]) {
  console.warn(LOG_PREFIX, ...args);
}
