import type { WatchHealth } from './watch-transport.ts';

export type WatchFallbackDecision = { readonly kind: 'continue' } | { readonly kind: 'fallback' };

export interface WatchFallbackPolicy {
  readonly reset: () => void;
  readonly evaluate: (health: WatchHealth) => WatchFallbackDecision;
}

export function createWatchFallbackPolicy(): WatchFallbackPolicy {
  let issued = false;

  return {
    reset() {
      issued = false;
    },
    evaluate(health) {
      switch (health.mode) {
        case 'managed-tab':
          return { kind: 'continue' };
        case 'tabless': {
          const requested = health.status === 'disabled' || health.shouldFallback;
          if (!requested || issued) return { kind: 'continue' };
          issued = true;
          return { kind: 'fallback' };
        }
        default:
          health.mode satisfies never;
          return { kind: 'continue' };
      }
    },
  };
}
