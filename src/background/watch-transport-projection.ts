import type { WatchHealthSnapshot, WatchTransportMode } from '../types/index.ts';
import type { ServiceWorkerState } from './runtime-state.ts';

export type WatchTransportProjection =
  | { readonly kind: 'started'; readonly health: WatchHealthSnapshot }
  | { readonly kind: 'checked'; readonly health: WatchHealthSnapshot }
  | { readonly kind: 'stopped'; readonly health: WatchHealthSnapshot }
  | { readonly kind: 'preference'; readonly mode: WatchTransportMode };

export interface WatchTransportProjectionStore {
  readonly currentHealth: () => WatchHealthSnapshot | null;
  readonly apply: (projection: WatchTransportProjection) => Promise<void>;
}

interface WatchTransportProjectionOptions {
  readonly state: ServiceWorkerState;
  readonly persist: () => Promise<void>;
  readonly broadcast: () => void;
}

export function createWatchTransportProjectionStore(
  options: WatchTransportProjectionOptions,
): WatchTransportProjectionStore {
  return {
    currentHealth: () => options.state.appState.watchHealth,
    async apply(projection) {
      const state = options.state.appState;
      switch (projection.kind) {
        case 'started':
          state.watchTransportMode = projection.health.mode;
          state.watchHealth = projection.health;
          break;
        case 'checked':
          state.watchTransportMode = projection.health.mode;
          state.watchHealth = projection.health;
          break;
        case 'stopped':
          state.pendingWatchTarget = null;
          state.watchTransportMode = projection.health.mode;
          state.watchHealth = {
            ...projection.health,
            status: 'stopped',
            reason: 'stopped',
          };
          break;
        case 'preference':
          state.watchTransportPreference = projection.mode;
          break;
        default:
          projection satisfies never;
      }
      await options.persist();
      options.broadcast();
    },
  };
}
