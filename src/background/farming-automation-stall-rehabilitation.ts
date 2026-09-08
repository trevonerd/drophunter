import { gameKey } from '../shared/game-selection.ts';
import type { TwitchGame, TwitchStreamer } from '../types/index.ts';
import { clearCampaignStallBlock, hasNewEligibleStreamerEvidence } from './stalled-campaign-block.ts';

export function rehabilitateCampaignsWithNewStreamers(
  state: {
    appState: {
      stalledCampaignBlocksByKey: Record<string, import('../types/index.ts').StalledCampaignBlock>;
    };
  },
  games: readonly TwitchGame[],
  directories: ReadonlyMap<string, { readonly streamers: readonly TwitchStreamer[] }>,
): void {
  for (const game of games) {
    const directory = directories.get(gameKey(game));
    if (
      directory &&
      hasNewEligibleStreamerEvidence(
        state.appState.stalledCampaignBlocksByKey[gameKey(game)],
        directory.streamers.map((streamer) => streamer.name),
      )
    ) {
      state.appState.stalledCampaignBlocksByKey = clearCampaignStallBlock(
        state.appState.stalledCampaignBlocksByKey,
        game,
      );
    }
  }
}
