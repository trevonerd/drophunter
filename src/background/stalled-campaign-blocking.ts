import { dropMatchesGame, gameKey, getGameDisplayLabel } from '../shared/game-selection.ts';
import type { TwitchGame, TwitchStreamer } from '../types/index.ts';
import type { AutomationEventNotifier } from './automation-event-notifier.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import { blockCampaignForStall, captureRewardProgress } from './stalled-campaign-block.ts';

type StalledCampaignBlockingInput = {
  readonly state: ServiceWorkerState;
  readonly now: () => number;
  readonly isCurrent?: () => boolean;
  readonly fetchDirectoryStreamers: (
    game: TwitchGame,
    forceSessionRefresh?: boolean,
    language?: string,
  ) => Promise<TwitchStreamer[] & { readonly languageFilterApplied: boolean }>;
  readonly notify?: AutomationEventNotifier['notify'];
};

export async function blockSelectedCampaignForStall(input: StalledCampaignBlockingInput): Promise<boolean> {
  if (input.isCurrent?.() === false) return false;
  const selectedGame = input.state.appState.selectedGame;
  if (!selectedGame) return false;
  const selectedKey = gameKey(selectedGame);
  const failedNamesAtStart =
    input.state.appState.queueEntryMetadataByKey[selectedKey]?.stalledStreamerNames ?? [];
  const hasSameFailureHistory = () => {
    const current = input.state.appState.queueEntryMetadataByKey[selectedKey]?.stalledStreamerNames ?? [];
    return (
      current.length === failedNamesAtStart.length &&
      current.every((name, index) => name === failedNamesAtStart[index])
    );
  };
  let directory: Awaited<ReturnType<StalledCampaignBlockingInput['fetchDirectoryStreamers']>> | null = null;
  try {
    directory = await input.fetchDirectoryStreamers(
      selectedGame,
      false,
      input.state.appState.preferredStreamerLanguage ?? '',
    );
  } catch {
    // Preserve confirmed failure evidence when Twitch cannot refresh the directory.
  }
  if (input.isCurrent?.() === false || !hasSameFailureHistory()) return false;
  const allowedChannels = new Set(
    (selectedGame.allowedChannels ?? []).map((channel) => channel.trim().toLowerCase()),
  );
  const knownFailedNames =
    input.state.appState.queueEntryMetadataByKey[gameKey(selectedGame)]?.stalledStreamerNames ?? [];
  const eligibleStreamerNames = [
    ...knownFailedNames,
    ...(directory ?? [])
      .filter(
        (streamer) =>
          streamer.isLive &&
          (allowedChannels.size === 0 || allowedChannels.has(streamer.name.trim().toLowerCase())),
      )
      .map((streamer) => streamer.name),
  ];
  const blockedAt = input.now();
  input.state.appState = {
    ...input.state.appState,
    stalledCampaignBlocksByKey: blockCampaignForStall(
      input.state.appState.stalledCampaignBlocksByKey,
      selectedGame,
      {
        blockedAt,
        rotationAttempts: input.state.stalledRecoveryAttempts,
        eligibleStreamerNames,
        rewardProgressByKey: captureRewardProgress(
          input.state.appState.allDrops.filter((drop) => dropMatchesGame(drop, selectedGame)),
        ),
      },
    ),
  };
  await input.notify?.({
    transitionId: `stall-exclusion:${gameKey(selectedGame)}:${blockedAt}`,
    event: 'exclusion',
    campaignId: selectedGame.campaignId ?? selectedGame.id,
    title: 'Campaign temporarily excluded',
    message: `DropHunter queued ${getGameDisplayLabel(selectedGame)} for another attempt after confirmed stalled progress. It will check the other campaigns, then retry the queue in ten minutes or sooner if new eligible streamers appear.`,
    priority: 1,
    telegramReason: 'campaign-excluded',
  });
  return input.isCurrent?.() !== false && hasSameFailureHistory();
}
