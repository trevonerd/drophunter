// This script runs in the MAIN world at document_start to intercept
// Twitch's own fetch calls to the integrity endpoint. The captured
// integrity token is stored in sessionStorage so the content script
// (running in ISOLATED world) can forward it to the background.

const STORAGE_KEY = '__drophunter_integrity__';
const DEBUG_LOGS_ENABLED = typeof __DROPHUNTER_DEBUG_LOGS__ === 'boolean' ? __DROPHUNTER_DEBUG_LOGS__ : false;

function logInterceptorDebug(...args: unknown[]) {
  if (DEBUG_LOGS_ENABLED) {
    console.debug('[DropHunter]', ...args);
  }
}

export function startIntegrityInterceptor(): void {
  const globals = window as Window & { __drophunter_interceptor__?: boolean };
  if (globals.__drophunter_interceptor__) {
    return;
  }
  globals.__drophunter_interceptor__ = true;

  const originalFetch = window.fetch;

  window.fetch = function (...args: Parameters<typeof fetch>): ReturnType<typeof fetch> {
    const url = typeof args[0] === 'string' ? args[0] : args[0] instanceof Request ? args[0].url : '';
    const promise = originalFetch.apply(this, args);

    if (url.includes('gql.twitch.tv/integrity')) {
      promise
        .then((response) => {
          const clone = response.clone();
          return clone.json();
        })
        .then((data: unknown) => {
          if (typeof data !== 'object') {
            logInterceptorDebug('[integrity-interceptor] unexpected response shape:', typeof data);
            return;
          }
          const payload = data as Record<string, unknown> | null;
          if (payload && typeof payload.token === 'string' && payload.token.length > 0) {
            const integrity = {
              token: payload.token,
              expiration: typeof payload.expiration === 'number' ? payload.expiration : 0,
              request_id: typeof payload.request_id === 'string' ? payload.request_id : '',
              timestamp: Date.now(),
            };
            try {
              window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(integrity));
            } catch {
              // sessionStorage might be full or blocked.
            }
            window.dispatchEvent(new CustomEvent(STORAGE_KEY, { detail: JSON.stringify(integrity) }));
          }
        })
        .catch((error: unknown) => {
          logInterceptorDebug('[integrity-interceptor] failed to parse response:', String(error));
        });
    }

    return promise;
  };
}
