import type { TwitchStreamer, WatchTransportMode } from '../types/index.ts';
import type { WatchOwnershipV1 } from './farming-automation-contracts.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import type {
  FarmingTarget,
  ManagedTabOperations,
  TablessHeartbeat,
  WatchHealth,
} from './watch-transport.ts';
import type { WatchTransportRuntime } from './watch-transport-transition.ts';

export interface WatchTransportCoordinatorOptions {
  readonly state: ServiceWorkerState;
  readonly heartbeat: (target: FarmingTarget) => Promise<TablessHeartbeat>;
  readonly managedTab: ManagedTabOperations;
  readonly enabled?: boolean;
  readonly now?: () => number;
  readonly minHeartbeatIntervalMs?: number;
  readonly persist: () => Promise<void>;
  readonly broadcast: () => void;
}

export interface WatchTransportCoordinator {
  readonly start: (streamer: TwitchStreamer, isCurrent?: () => boolean) => Promise<WatchHealth>;
  readonly tick: (isCurrent?: () => boolean) => Promise<WatchHealth>;
  readonly stop: () => Promise<void>;
  readonly setPreference: (mode: WatchTransportMode) => Promise<void>;
}

export interface WatchTransportRuntimeCoordinator extends WatchTransportCoordinator, WatchTransportRuntime {
  readonly restore: (ownership: WatchOwnershipV1) => Promise<boolean>;
}
