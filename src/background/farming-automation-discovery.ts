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
  try {
    for (const normalized of refreshed.snapshot.games) {
      const game = cloneFarmingAutomationGame(normalized);
      const directory = await twitch.fetchDirectory(game, language);
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
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return { kind: 'failed', reason: 'drops-refresh-failed' };
  }
  return { kind: 'ready', snapshot: refreshed.snapshot, directories, availability };
}
