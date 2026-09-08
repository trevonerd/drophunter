import { dropMatchesGame, gameKey, getGameDisplayLabel } from '../shared/game-selection.ts';
import type { TwitchGame, TwitchStreamer } from '../types/index.ts';
import type { AutomationEventNotifier } from './automation-event-notifier.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import { blockCampaignForStall, captureRewardProgress } from './stalled-campaign-block.ts';

type StalledCampaignBlockingInput = {
  readonly state: ServiceWorkerState;
  readonly now: () => number;
  readonly fetchDirectoryStreamers: (
    game: TwitchGame,
    forceSessionRefresh?: boolean,
    language?: string,
  ) => Promise<TwitchStreamer[] & { readonly languageFilterApplied: boolean }>;
  readonly notify?: AutomationEventNotifier['notify'];
};

export async function blockSelectedCampaignForStall(input: StalledCampaignBlockingInput): Promise<void> {
  const selectedGame = input.state.appState.selectedGame;
  if (!selectedGame) return;
  const directory = await input.fetchDirectoryStreamers(
    selectedGame,
    false,
    input.state.appState.preferredStreamerLanguage ?? '',
  );
  const allowedChannels = new Set(
    (selectedGame.allowedChannels ?? []).map((channel) => channel.trim().toLowerCase()),
  );
  const eligibleStreamerNames = directory
    .filter(
      (streamer) =>
        streamer.isLive &&
        (allowedChannels.size === 0 || allowedChannels.has(streamer.name.trim().toLowerCase())),
    )
    .map((streamer) => streamer.name);
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
    message: `DropHunter paused ${getGameDisplayLabel(selectedGame)} after confirmed stalled progress. It will retry only when Twitch reports new eligible streamers, progress resumes, or you start it again.`,
    priority: 1,
    telegramReason: 'campaign-excluded',
  });
}
