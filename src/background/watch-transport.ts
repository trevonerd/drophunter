import type {
  PlaybackPrepResult,
  WatchHealthReason,
  WatchHealthSnapshot,
  WatchTransportMode,
} from '../types/index.ts';
import type { WatchOwnershipV1 } from './farming-automation-contracts.ts';

export function parsePlaybackPrepResult(value: unknown): PlaybackPrepResult {
  if (typeof value !== 'object' || value === null) return {};
  const result: PlaybackPrepResult = {};
  if ('gateDismissed' in value && typeof value.gateDismissed === 'boolean') {
    result.gateDismissed = value.gateDismissed;
  }
  if ('isPlaybackReady' in value && typeof value.isPlaybackReady === 'boolean') {
    result.isPlaybackReady = value.isPlaybackReady;
  }
  if ('userInteractionRequired' in value && typeof value.userInteractionRequired === 'boolean') {
    result.userInteractionRequired = value.userInteractionRequired;
  }
  return result;
}

/**
 * A campaign/channel pair that a farming session wants to watch.
 *
 * The transport deliberately does not accept a browser tab id here. A managed
 * tab adapter owns the tab it opens and returns an opaque, DropHunter-owned
 * session handle instead.
 */
export interface FarmingTarget {
  readonly gameId: string;
  readonly selectionId?: string;
  readonly campaignId?: string;
  readonly categorySlug?: string;
  readonly channelName: string;
}

export type { WatchHealthReason, WatchHealthStatus, WatchTransportMode } from '../types/index.ts';
export type WatchHealth = WatchHealthSnapshot;

/** Signals returned by a managed-tab probe or a tabless heartbeat. */
export interface WatchProbeResult {
  readonly accepted: boolean;
  readonly isLive?: boolean;
  readonly sameChannel?: boolean;
  readonly sameGame?: boolean;
  readonly hasDropsSignal?: boolean;
  readonly progress?: number | null;
  readonly reason?: WatchHealthReason;
}

export type TablessHeartbeat = WatchProbeResult;

/**
 * The only tab identity accepted by ManagedTabTransport. Adapters must stamp
 * handles they create with `owner: 'drophunter'`; user-created tabs cannot be
 * passed into the transport by accident.
 */
export interface ManagedTabSession {
  readonly owner: 'drophunter';
  readonly tabId: number;
  readonly ownership?: Extract<WatchOwnershipV1, { readonly kind: 'managed-tab' }>;
}

export interface UnmanagedTabSession {
  readonly owner: 'user';
  readonly tabId: number;
}

export type ManagedTabOpenResult = ManagedTabSession | UnmanagedTabSession | null;

export interface ManagedTabStartOptions {
  readonly active: false;
  readonly focus: false;
}

export interface ManagedTabOperations {
  open(target: FarmingTarget, options: ManagedTabStartOptions): Promise<ManagedTabOpenResult>;
  probe(session: ManagedTabSession, target: FarmingTarget): Promise<WatchProbeResult>;
  close(session: ManagedTabSession): Promise<void>;
}

export interface WatchTransport {
  readonly mode: WatchTransportMode;
  adopt(target: FarmingTarget, ownership: WatchOwnershipV1, health: WatchHealth): boolean;
  currentOwnership(): WatchOwnershipV1 | null;
  start(target: FarmingTarget): Promise<WatchHealth>;
  tick(): Promise<WatchHealth>;
  stop(): Promise<void>;
}

export interface ManagedTabTransportOptions extends ManagedTabOperations {
  readonly now?: () => number;
  readonly failedProbeLimit?: number;
}

export interface TablessTransportOptions {
  /** Set false for store builds until the no-tab compliance gate is approved. */
  readonly enabled: boolean;
  readonly heartbeat: (target: FarmingTarget) => Promise<TablessHeartbeat>;
  readonly onFallback?: () => Promise<void> | void;
  readonly now?: () => number;
  readonly failedHeartbeatLimit?: number;
  readonly stalledProgressHeartbeats?: number;
}

export { ManagedTabTransport } from './managed-tab-transport.ts';
export {
  createTablessTransport,
  TABLESS_HEARTBEAT_FAILURE_LIMIT,
  TablessTransport,
} from './tabless-transport.ts';
