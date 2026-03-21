const LOG_PREFIX = '[DropHunter]';
const VERBOSE_LOGS_ENABLED = import.meta.env.DEV;

export function logInfo(...args: unknown[]) {
  console.info(LOG_PREFIX, ...args);
}

export function logDebug(...args: unknown[]) {
  if (VERBOSE_LOGS_ENABLED) {
    console.debug(LOG_PREFIX, ...args);
  }
}

export function logWarn(...args: unknown[]) {
  console.warn(LOG_PREFIX, ...args);
}

export function logVerboseInfo(...args: unknown[]) {
  if (VERBOSE_LOGS_ENABLED) {
    console.info(LOG_PREFIX, ...args);
  }
}

export function logVerboseWarn(...args: unknown[]) {
  if (VERBOSE_LOGS_ENABLED) {
    console.warn(LOG_PREFIX, ...args);
  }
}
