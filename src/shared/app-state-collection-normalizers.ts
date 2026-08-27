import type { AppState, TwitchDrop } from '../types/index.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeFavoriteGames(value: unknown): AppState['favoriteGames'] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (entry): entry is Record<string, unknown> & AppState['favoriteGames'][number] =>
        isRecord(entry) &&
        typeof entry.gameId === 'string' &&
        entry.gameId.trim().length > 0 &&
        typeof entry.lastKnownName === 'string' &&
        Number.isFinite(entry.addedAt),
    )
    .map((entry) => ({
      gameId: entry.gameId,
      lastKnownName: entry.lastKnownName,
      addedAt: entry.addedAt,
      ...(Array.isArray(entry.identityKeys)
        ? {
            identityKeys: Array.from(
              new Set(
                entry.identityKeys.filter(
                  (key): key is string => typeof key === 'string' && key.trim().length > 0,
                ),
              ),
            ),
          }
        : {}),
    }));
}

export function normalizeHiddenGames(value: unknown): AppState['hiddenGames'] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (entry): entry is Record<string, unknown> & AppState['hiddenGames'][number] =>
        isRecord(entry) &&
        typeof entry.gameId === 'string' &&
        entry.gameId.trim().length > 0 &&
        typeof entry.lastKnownName === 'string' &&
        Number.isFinite(entry.hiddenAt),
    )
    .map((entry) => ({
      gameId: entry.gameId,
      lastKnownName: entry.lastKnownName,
      hiddenAt: entry.hiddenAt,
      ...(Array.isArray(entry.identityKeys)
        ? {
            identityKeys: Array.from(
              new Set(
                entry.identityKeys.filter(
                  (key): key is string => typeof key === 'string' && key.trim().length > 0,
                ),
              ),
            ),
          }
        : {}),
    }));
}

export function normalizeQueueMetadata(value: unknown): AppState['queueEntryMetadataByKey'] {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, AppState['queueEntryMetadataByKey'][string]] => {
      const metadata = entry[1];
      return (
        isRecord(metadata) &&
        (metadata.source === 'manual' || metadata.source === 'favorite-auto') &&
        Number.isFinite(metadata.addedAt) &&
        (metadata.reason === 'user-added' ||
          metadata.reason === 'favorite-discovered' ||
          metadata.reason === 'retained-after-hide')
      );
    }),
  );
}

export function normalizeAutomationActivity(value: unknown): AppState['automationActivity'] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is AppState['automationActivity'][number] =>
      isRecord(entry) &&
      typeof entry.id === 'string' &&
      (entry.kind === 'favorite-added' ||
        entry.kind === 'auto-started' ||
        entry.kind === 'preempted' ||
        entry.kind === 'auto-start-skipped') &&
      Number.isFinite(entry.at) &&
      typeof entry.message === 'string' &&
      (entry.campaignId === undefined || typeof entry.campaignId === 'string'),
  );
}

export function normalizeCampaignAvailability(value: unknown): AppState['campaignAvailabilityByKey'] {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, AppState['campaignAvailabilityByKey'][string]] => {
        const availability = entry[1];
        return (
          isRecord(availability) &&
          Number.isInteger(availability.eligibleStreamerCount) &&
          typeof availability.eligibleStreamerCount === 'number' &&
          availability.eligibleStreamerCount >= 0 &&
          Number.isFinite(availability.updatedAt)
        );
      },
    ),
  );
}

function isStoredTwitchDrop(value: unknown): value is TwitchDrop {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.gameId === 'string' &&
    typeof value.gameName === 'string' &&
    typeof value.imageUrl === 'string' &&
    typeof value.progress === 'number' &&
    Number.isFinite(value.progress) &&
    typeof value.currentMinutes === 'number' &&
    Number.isFinite(value.currentMinutes) &&
    typeof value.claimed === 'boolean' &&
    ['watch-time', 'subscription', 'other-event', 'unknown'].includes(value.acquisitionMethod as string) &&
    ['in-game', 'twitch-badge', 'twitch-emote', 'unknown'].includes(value.rewardKind as string) &&
    ['unassessed', 'verified', 'unverifiable'].includes(value.verificationState as string)
  );
}

export function normalizeCampaignDrops(value: unknown): AppState['campaignDropsByKey'] {
  if (!isRecord(value)) return {};
  const result: AppState['campaignDropsByKey'] = {};
  for (const [key, drops] of Object.entries(value)) {
    if (key && Array.isArray(drops)) result[key] = drops.filter(isStoredTwitchDrop);
  }
  return result;
}
