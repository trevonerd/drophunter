import type { AppState, TwitchDrop } from '../types/index.ts';
import { isRecord } from './app-state-normalization-values.ts';

export function normalizeStoredDrops(value: unknown): TwitchDrop[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): TwitchDrop[] => {
    if (
      !isRecord(entry) ||
      typeof entry.id !== 'string' ||
      !entry.id.trim() ||
      typeof entry.gameId !== 'string' ||
      !entry.gameId.trim()
    )
      return [];
    const method = entry.acquisitionMethod;
    const kind = entry.rewardKind;
    const verification = entry.verificationState;
    return [
      {
        ...entry,
        id: entry.id,
        gameId: entry.gameId,
        name: typeof entry.name === 'string' ? entry.name : entry.id,
        gameName: typeof entry.gameName === 'string' ? entry.gameName : entry.gameId,
        imageUrl: typeof entry.imageUrl === 'string' ? entry.imageUrl : '',
        progress:
          typeof entry.progress === 'number' && Number.isFinite(entry.progress)
            ? Math.max(0, Math.min(100, entry.progress))
            : 0,
        currentMinutes:
          typeof entry.currentMinutes === 'number' && Number.isFinite(entry.currentMinutes)
            ? Math.max(0, entry.currentMinutes)
            : 0,
        claimed: entry.claimed === true,
        acquisitionMethod:
          method === 'watch-time' || method === 'subscription' || method === 'other-event'
            ? method
            : 'unknown',
        rewardKind:
          kind === 'in-game' || kind === 'twitch-badge' || kind === 'twitch-emote' ? kind : 'unknown',
        verificationState:
          verification === 'verified' || verification === 'unverifiable' ? verification : 'unassessed',
      } as TwitchDrop,
    ];
  });
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

function normalizeStreamerNames(names: readonly unknown[]): string[] {
  return [
    ...new Set(
      names
        .filter((name): name is string => typeof name === 'string')
        .map((name) => name.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

export function normalizeQueueMetadata(value: unknown): AppState['queueEntryMetadataByKey'] {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        (entry): entry is [string, AppState['queueEntryMetadataByKey'][string] & Record<string, unknown>] => {
          const metadata = entry[1];
          return (
            isRecord(metadata) &&
            (metadata.source === 'manual' || metadata.source === 'favorite-auto') &&
            Number.isFinite(metadata.addedAt) &&
            (metadata.reason === 'user-added' ||
              metadata.reason === 'favorite-discovered' ||
              metadata.reason === 'retained-after-hide')
          );
        },
      )
      .map(([key, typedMetadata]) => {
        const metadata: Record<string, unknown> & typeof typedMetadata = typedMetadata;
        const {
          streamerRetryAt,
          streamerRetryReason,
          streamerRetryAttempts: _legacyAttempts,
          streamerRetryCycles: _legacyCycles,
          streamerWaitState,
          stalledStreamerNames,
          failedPlaybackStreamerNames,
          attemptedStreamerNames,
          parkedStreamerNames,
          watchAttempt,
          ...provenance
        } = metadata;
        const validRetry =
          typeof streamerRetryAt === 'number' && Number.isFinite(streamerRetryAt) && streamerRetryAt > 0;
        return [
          key,
          {
            source: provenance.source,
            addedAt: provenance.addedAt,
            reason: provenance.reason,
            ...(validRetry ? { streamerRetryAt: Math.min(streamerRetryAt, Date.now() + 600_000) } : {}),
            ...(validRetry &&
            (streamerRetryReason === 'no-streamers' ||
              streamerRetryReason === 'directory-unavailable' ||
              streamerRetryReason === 'open-failed' ||
              streamerRetryReason === 'stalled-progress')
              ? { streamerRetryReason }
              : {}),
            ...(streamerWaitState === 'availability' ? { streamerWaitState } : {}),
            ...([attemptedStreamerNames, stalledStreamerNames, failedPlaybackStreamerNames].some(
              Array.isArray,
            )
              ? {
                  attemptedStreamerNames: [
                    ...new Set(
                      [attemptedStreamerNames, stalledStreamerNames, failedPlaybackStreamerNames]
                        .flatMap((names) => (Array.isArray(names) ? names : []))
                        .filter((name): name is string => typeof name === 'string')
                        .map((name) => name.trim().toLowerCase())
                        .filter(Boolean),
                    ),
                  ].slice(0, 4),
                }
              : {}),
            ...(validRetry && streamerRetryReason === 'stalled-progress' && Array.isArray(parkedStreamerNames)
              ? { parkedStreamerNames: normalizeStreamerNames(parkedStreamerNames) }
              : {}),
            ...(isRecord(watchAttempt) &&
            typeof watchAttempt.channelName === 'string' &&
            watchAttempt.channelName.trim() &&
            typeof watchAttempt.observedAt === 'number' &&
            Number.isFinite(watchAttempt.observedAt) &&
            watchAttempt.observedAt > 0
              ? {
                  watchAttempt: {
                    channelName: watchAttempt.channelName.trim().toLowerCase(),
                    observedAt: Math.min(watchAttempt.observedAt, Date.now()),
                    ...(watchAttempt.preparing === true ? { preparing: true } : {}),
                    ...(typeof watchAttempt.preparationProgress === 'number' &&
                    Number.isFinite(watchAttempt.preparationProgress) &&
                    watchAttempt.preparationProgress >= 0
                      ? { preparationProgress: watchAttempt.preparationProgress }
                      : {}),
                    ...(typeof watchAttempt.suspendedAt === 'number' &&
                    Number.isFinite(watchAttempt.suspendedAt) &&
                    watchAttempt.suspendedAt >= watchAttempt.observedAt
                      ? { suspendedAt: Math.min(watchAttempt.suspendedAt, Date.now()) }
                      : {}),
                    ...(typeof watchAttempt.firstPlaybackAt === 'number' &&
                    Number.isFinite(watchAttempt.firstPlaybackAt) &&
                    watchAttempt.firstPlaybackAt >= watchAttempt.observedAt
                      ? { firstPlaybackAt: Math.min(watchAttempt.firstPlaybackAt, Date.now()) }
                      : {}),
                  },
                }
              : {}),
          },
        ];
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
        entry.kind === 'auto-start-skipped' ||
        entry.kind === 'campaign-unfarmable' ||
        entry.kind === 'queue-campaign-skipped' ||
        entry.kind === 'queue-retries-exhausted' ||
        entry.kind === 'queue-campaigns-removed') &&
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
