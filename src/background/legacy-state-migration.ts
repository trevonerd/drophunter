import { normalizeStoredAppState } from '../shared/app-state-sync.ts';
import { createInitialState } from '../shared/utils.ts';
import type { AppState } from '../types/index.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function validNonNegativeInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function validEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/**
 * Convert pre-v4 state into the durable user-owned portion of AppState.
 * Twitch campaign data and all runtime/session fields intentionally come from
 * createInitialState rather than being carried forward from the old state.
 */
export function transformLegacyAppState(value: unknown): AppState {
  const defaults = createInitialState();
  const normalized = normalizeStoredAppState(value);
  const source = isRecord(value) ? value : {};

  return {
    ...defaults,
    totalDropsClaimed: validNonNegativeInteger(source.totalDropsClaimed, defaults.totalDropsClaimed),
    totalChannelPointsClaimed: validNonNegativeInteger(
      source.totalChannelPointsClaimed,
      defaults.totalChannelPointsClaimed,
    ),
    monitorAutoOpen: validBoolean(source.monitorAutoOpen, defaults.monitorAutoOpen),
    autoResumeOnStartup: validBoolean(source.autoResumeOnStartup, defaults.autoResumeOnStartup),
    muteFarmingTab: validBoolean(source.muteFarmingTab, defaults.muteFarmingTab),
    notificationsEnabled: validBoolean(source.notificationsEnabled, defaults.notificationsEnabled),
    telegramAlertsEnabled: validBoolean(source.telegramAlertsEnabled, defaults.telegramAlertsEnabled),
    telegramSystemAlertsEnabled: validBoolean(
      source.telegramSystemAlertsEnabled,
      defaults.telegramSystemAlertsEnabled,
    ),
    autoClaimChannelPointsBonus: validBoolean(
      source.autoClaimChannelPointsBonus,
      defaults.autoClaimChannelPointsBonus,
    ),
    autoClaimDrops: validBoolean(source.autoClaimDrops, defaults.autoClaimDrops),
    streamerSelectionMode: validEnum(
      source.streamerSelectionMode,
      ['low-view', 'random', 'top-viewers'],
      defaults.streamerSelectionMode,
    ),
    preferredStreamerLanguage:
      typeof source.preferredStreamerLanguage === 'string' ? source.preferredStreamerLanguage : null,
    favoriteGames: normalized.favoriteGames,
    hiddenGames: normalized.hiddenGames,
    campaignPriorityMode: defaults.campaignPriorityMode,
    farmCategoryScope: validEnum(
      source.farmCategoryScope,
      ['all', 'favorites-only'],
      defaults.farmCategoryScope,
    ),
    autoStartFavoriteGames: validBoolean(source.autoStartFavoriteGames, defaults.autoStartFavoriteGames),
    watchTransportPreference: validEnum(
      source.watchTransportPreference,
      ['tabless', 'managed-tab'],
      defaults.watchTransportPreference,
    ),
    watchTransportMode: defaults.watchTransportMode,
  };
}
