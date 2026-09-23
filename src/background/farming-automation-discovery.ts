import { campaignRejectionReason } from '../shared/campaign-eligibility.ts';
import { gameKey } from '../shared/game-selection.ts';
import type { CampaignAvailability } from '../types/index.ts';
import type { FarmingAutomationFailureReason } from './farming-automation-contracts.ts';
import {
  cloneFarmingAutomationGame,
  eligibleFarmingAutomationStreamers,
  type FarmingAutomationDirectoryCacheEntry,
} from './farming-automation-gates.ts';
import { reconcileFarmingAutomationSnapshot } from './farming-automation-reconciliation.ts';
import type {
  FarmingAutomationTwitchAdapter,
  FarmingAutomationTwitchSnapshot,
} from './farming-automation-twitch.ts';
import { logDebug } from './logging.ts';
import type { ServiceWorkerState } from './runtime-state.ts';

export type FarmingAutomationDiscoveryResult =
  | {
      readonly kind: 'ready';
      readonly snapshot: FarmingAutomationTwitchSnapshot;
      readonly directories: ReadonlyMap<string, FarmingAutomationDirectoryCacheEntry>;
      readonly availability: Readonly<Record<string, CampaignAvailability>>;
      readonly directoryFailures: ReadonlySet<string>;
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
  state?: ServiceWorkerState,
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

  const snapshot = state ? reconcileFarmingAutomationSnapshot(refreshed.snapshot, state) : refreshed.snapshot;
  const directories = new Map<string, FarmingAutomationDirectoryCacheEntry>();
  const availability: Record<string, CampaignAvailability> = {};
  const directoryFailures = new Set<string>();
  const farmableGames = snapshot.games.filter((game) => {
    const rejectionReason =
      campaignRejectionReason(cloneFarmingAutomationGame(game), now) ??
      (game.rewardSummary?.completion === 'farmable' ? null : 'unclassified');
    if (rejectionReason === null) return true;
    logDebug('Campaign rejected before automatic queue planning', {
      campaignId: game.campaignId,
      completion: game.rewardSummary?.completion,
      rejectionReason,
    });
    return false;
  });
  const directoryResponses = await Promise.all(
    farmableGames.map(async (normalized) => {
      const game = cloneFarmingAutomationGame(normalized);
      try {
        return { game, directory: await twitch.fetchDirectory(game, language) } as const;
      } catch (error) {
        logDebug('Campaign directory lookup failed; isolating candidate', {
          campaignKey: gameKey(game),
          message: error instanceof Error ? error.message : String(error),
        });
        return { game, directory: null } as const;
      }
    }),
  );
  for (const { game, directory } of directoryResponses) {
    if (directory === null) {
      directoryFailures.add(gameKey(game));
      continue;
    }
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
  return { kind: 'ready', snapshot, directories, availability, directoryFailures };
}
