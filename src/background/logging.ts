const LOG_PREFIX = '[DropHunter]';
const DEBUG_LOGS_ENABLED = typeof __DROPHUNTER_DEBUG_LOGS__ === 'boolean' ? __DROPHUNTER_DEBUG_LOGS__ : false;

export function logInfo(...args: unknown[]) {
  if (DEBUG_LOGS_ENABLED) {
    console.info(LOG_PREFIX, ...args);
  }
}

export function logDebug(...args: unknown[]) {
  if (DEBUG_LOGS_ENABLED) {
    console.debug(LOG_PREFIX, ...args);
  }
}

export function logWarn(...args: unknown[]) {
  console.warn(LOG_PREFIX, ...args);
}

export function logVerboseInfo(...args: unknown[]) {
  if (DEBUG_LOGS_ENABLED) {
    console.info(LOG_PREFIX, ...args);
  }
}

export function logVerboseWarn(...args: unknown[]) {
  if (DEBUG_LOGS_ENABLED) {
    console.warn(LOG_PREFIX, ...args);
  }
}
