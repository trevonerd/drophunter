const LOG_PREFIX = '[DropHunter]';
const DEBUG_LOGS_ENABLED = typeof __DROPHUNTER_DEBUG_LOGS__ === 'boolean' ? __DROPHUNTER_DEBUG_LOGS__ : false;

export function logPopupWarn(...args: unknown[]) {
  if (DEBUG_LOGS_ENABLED) {
    console.warn(LOG_PREFIX, ...args);
  }
}

export function logPopupError(...args: unknown[]) {
  console.error(LOG_PREFIX, ...args);
}
