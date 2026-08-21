import { gameKey } from '../shared/game-selection.ts';
import type { CampaignAvailability } from '../types/index.ts';
import type { FarmingAutomationFailureReason } from './farming-automation-contracts.ts';
import {
  cloneFarmingAutomationGame,
  eligibleFarmingAutomationStreamers,
  type FarmingAutomationDirectoryCacheEntry,
} from './farming-automation-gates.ts';
import type {
  FarmingAutomationTwitchAdapter,
  FarmingAutomationTwitchSnapshot,
} from './farming-automation-twitch.ts';

export type FarmingAutomationDiscoveryResult =
  | {
      readonly kind: 'ready';
      readonly snapshot: FarmingAutomationTwitchSnapshot;
      readonly directories: ReadonlyMap<string, FarmingAutomationDirectoryCacheEntry>;
      readonly availability: Readonly<Record<string, CampaignAvailability>>;
    }
  | {
      readonly kind: 'failed';
      readonly reason: Extract<
        FarmingAutomationFailureReason,
        'drops-refresh-failed' | 'twitch-session-missing'
      >;
    };

export async function discoverFarmingAutomationCandidates(
  twitch: FarmingAutomationTwitchAdapter,
  language: string,
  now: number,
): Promise<FarmingAutomationDiscoveryResult> {
  let refreshed: Awaited<ReturnType<FarmingAutomationTwitchAdapter['refresh']>>;
  try {
    refreshed = await twitch.refresh();
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return { kind: 'failed', reason: 'drops-refresh-failed' };
  }
  if (refreshed.kind === 'session-missing') {
    return { kind: 'failed', reason: 'twitch-session-missing' };
  }

  const directories = new Map<string, FarmingAutomationDirectoryCacheEntry>();
  const availability: Record<string, CampaignAvailability> = {};
  const farmableGames = refreshed.snapshot.games.filter(
    (game) => game.rewardSummary?.completion === 'farmable',
  );
  let directoryResponses: readonly {
    readonly game: ReturnType<typeof cloneFarmingAutomationGame>;
    readonly directory: Awaited<ReturnType<typeof twitch.fetchDirectory>>;
  }[];
  try {
    directoryResponses = await Promise.all(
      farmableGames.map(async (normalized) => {
        const game = cloneFarmingAutomationGame(normalized);
        return { game, directory: await twitch.fetchDirectory(game, language) };
      }),
    );
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return { kind: 'failed', reason: 'drops-refresh-failed' };
  }
  for (const { game, directory } of directoryResponses) {
    if (directory.kind === 'session-missing') {
      return { kind: 'failed', reason: 'twitch-session-missing' };
    }
    const streamers = eligibleFarmingAutomationStreamers(game, directory);
    directories.set(gameKey(game), {
      streamers,
      languageFilterApplied: directory.languageFilterApplied,
    });
    availability[gameKey(game)] = { eligibleStreamerCount: streamers.length, updatedAt: now };
  }
  return { kind: 'ready', snapshot: refreshed.snapshot, directories, availability };
}
