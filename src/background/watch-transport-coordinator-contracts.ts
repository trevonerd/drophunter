import type { TwitchStreamer, WatchTransportMode } from '../types/index.ts';
import type { WatchOwnershipV1 } from './farming-automation-contracts.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import type { WatchStartResult } from './streamer-acquisition-contracts.ts';
import type {
  FarmingTarget,
  ManagedTabOperations,
  TablessHeartbeat,
  WatchHealth,
} from './watch-transport.ts';
import type { WatchPreparation, WatchTransportRuntime } from './watch-transport-transition.ts';

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
  readonly start: (streamer: TwitchStreamer, isCurrent?: () => boolean) => Promise<WatchStartResult>;
  readonly prepare?: (target: FarmingTarget, isCurrent?: () => boolean) => Promise<WatchPreparation>;
  readonly currentTarget?: () => FarmingTarget | null;
  readonly tick: (isCurrent?: () => boolean) => Promise<WatchHealth>;
  readonly stop: () => Promise<void>;
  readonly setPreference: (mode: WatchTransportMode) => Promise<void>;
}

export interface WatchTransportRuntimeCoordinator extends WatchTransportCoordinator, WatchTransportRuntime {
  readonly prepare: (target: FarmingTarget, isCurrent?: () => boolean) => Promise<WatchPreparation>;
  readonly currentTarget: () => FarmingTarget | null;
  readonly restore: (ownership: WatchOwnershipV1) => Promise<boolean>;
}
