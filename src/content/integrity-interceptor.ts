// This script runs in the MAIN world at document_start to intercept
// Twitch's own fetch calls to the integrity endpoint. The captured
// integrity token is stored in sessionStorage so the content script
// (running in ISOLATED world) can forward it to the background.

const STORAGE_KEY = '__drophunter_integrity__';

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
            // sessionStorage might be full or blocked
          }
          window.dispatchEvent(
            new CustomEvent(STORAGE_KEY, { detail: JSON.stringify(integrity) }),
          );
        }
      })
      .catch(() => {
        // Silently ignore errors in the interceptor
      });
  }

  return promise;
};
