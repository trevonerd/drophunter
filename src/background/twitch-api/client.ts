import type { DropsSnapshot, TwitchDrop } from '../../types';
import {
  applyEarlyTwitchRewardClaimsToDrops,
  buildClaimedRewardLookup,
  buildGlobalClaimedIdCounts,
  buildGlobalClaimedRewardEntry,
  type ClaimedRewardEntry,
  type ClaimedRewardLookup,
  hasClaimedGameEventReward,
  isEarlyAwardableTwitchReward,
  matchClaimedReward,
  resolveDropClaimedStatus,
} from './claimed-rewards';
import {
  buildDirectoryPayload,
  type DirectoryStreamersResult,
  fetchDirectoryStreamers,
} from './directory-operations';
import { TwitchGqlTransport } from './gql';
import { applyInventoryToDrops } from './inventory-drops';
import {
  buildConflictedRewardBenefitKeys,
  classifyRewardAcquisitionMethod,
  classifyRewardKind,
  computeExpiry,
  extractBenefitDistributionTypes,
  extractBenefitIds,
  extractBenefitNames,
  normalizeImageUrl,
  normalizeText,
  toIsoDate,
  toNumber,
} from './parsing';
import { CLAIM_DROP_REWARD_QUERY, CURRENT_USER_QUERY, INVENTORY_QUERY } from './queries';
import { hasVerifiedInventory } from './snapshot-composition';
import { type FetchDropsSnapshotOptions, fetchUncoalescedDropsSnapshot } from './snapshot-fetch';
import type { TwitchSession } from './types';

const inFlightSnapshotRefreshes = new Map<string, Promise<DropsSnapshot>>();

export { parseCampaignDrops } from './campaign-drop-parsing';
export {
  extractCampaignRewardDrops,
  isCampaignUsable,
  isTwitchNativeCampaign,
  parseGameFromCampaign,
} from './campaign-model';
export {
  extractBroadcasterLanguage,
  normalizeLanguageForApi,
  normalizeStreamerLanguage,
} from './directory-operations';
export type { InventoryDropMaps } from './inventory-drops';
export { buildInventoryDropMaps, findInventoryStateForDrop } from './inventory-drops';
export type { FetchDropsSnapshotOptions } from './snapshot-fetch';
export type { ClaimedRewardEntry, ClaimedRewardLookup };
export {
  applyEarlyTwitchRewardClaimsToDrops,
  buildClaimedRewardLookup,
  buildConflictedRewardBenefitKeys,
  buildGlobalClaimedIdCounts,
  buildGlobalClaimedRewardEntry,
  classifyRewardAcquisitionMethod,
  classifyRewardKind,
  computeExpiry,
  extractBenefitDistributionTypes,
  extractBenefitIds,
  extractBenefitNames,
  hasClaimedGameEventReward,
  isEarlyAwardableTwitchReward,
  matchClaimedReward,
  normalizeImageUrl,
  normalizeText,
  resolveDropClaimedStatus,
  toIsoDate,
  toNumber,
};

export class TwitchApiClient {
  private readonly transport: TwitchGqlTransport;
  private readonly session: TwitchSession;
  private readonly campaignDetailsCache = new Map<string, Record<string, unknown>>();
  private lastValidSnapshot: DropsSnapshot | null = null;

  constructor(session: TwitchSession) {
    this.transport = new TwitchGqlTransport(session);
    this.session = session;
  }

  async fetchCurrentUserId(): Promise<string | null> {
    const data = await this.transport.postAuthorized<{ currentUser?: { id?: string } }>(CURRENT_USER_QUERY);
    const userId = data.currentUser?.id;
    return typeof userId === 'string' && userId.trim() ? userId.trim() : null;
  }

  private snapshotRefreshKey(): string {
    return JSON.stringify([
      this.session.oauthToken,
      this.session.userId,
      this.session.deviceId,
      this.session.uuid,
      this.session.clientId ?? '',
      this.session.clientIntegrity ?? '',
    ]);
  }

  async fetchDropsSnapshot(options: FetchDropsSnapshotOptions = {}): Promise<DropsSnapshot> {
    const refreshKey = this.snapshotRefreshKey();
    const existingRefresh = inFlightSnapshotRefreshes.get(refreshKey);
    if (existingRefresh) {
      return existingRefresh;
    }

    const refresh = this.fetchDropsSnapshotUncoalesced(options);
    inFlightSnapshotRefreshes.set(refreshKey, refresh);
    refresh.then(
      () => {
        if (inFlightSnapshotRefreshes.get(refreshKey) === refresh) {
          inFlightSnapshotRefreshes.delete(refreshKey);
        }
      },
      () => {
        if (inFlightSnapshotRefreshes.get(refreshKey) === refresh) {
          inFlightSnapshotRefreshes.delete(refreshKey);
        }
      },
    );
    return refresh;
  }

  private async fetchDropsSnapshotUncoalesced(options: FetchDropsSnapshotOptions): Promise<DropsSnapshot> {
    const result = await fetchUncoalescedDropsSnapshot({
      transport: this.transport,
      session: this.session,
      campaignDetailsCache: this.campaignDetailsCache,
      lastValidSnapshot: this.lastValidSnapshot,
      options,
    });
    this.lastValidSnapshot = result.lastValidSnapshot;
    return result.snapshot;
  }

  async fetchInventorySnapshot(baseDrops: TwitchDrop[]): Promise<DropsSnapshot> {
    const data = await this.transport.postAuthorized<{
      currentUser?: { inventory?: Record<string, unknown> };
    }>(INVENTORY_QUERY);
    const inventoryRaw = data.currentUser?.inventory;

    if (!hasVerifiedInventory(inventoryRaw)) {
      throw new Error('Twitch inventory snapshot is unavailable or incomplete.');
    }

    const drops = applyEarlyTwitchRewardClaimsToDrops(
      applyInventoryToDrops(baseDrops, inventoryRaw),
      inventoryRaw,
    );
    return {
      games: [],
      drops,
      inventoryVerified: true,
      updatedAt: Date.now(),
    };
  }

  async claimDropReward(dropInstanceId: string): Promise<boolean> {
    const claimId = normalizeText(dropInstanceId);
    if (!claimId) {
      return false;
    }

    const payload = {
      ...CLAIM_DROP_REWARD_QUERY,
      variables: {
        input: {
          dropInstanceID: claimId,
        },
      },
    };

    const data = await this.transport.postAuthorized<{
      claimDropRewards?: {
        status?: string;
        error?: {
          message?: string;
        } | null;
      };
    }>(payload);

    const claimResponse = data.claimDropRewards;
    if (!claimResponse) {
      // Ambiguous response — do not mark as claimed locally. Claim is
      // idempotent server-side, so a retry next tick is safe.
      return false;
    }

    const errorMessage = normalizeText(claimResponse.error?.message);
    if (errorMessage) {
      throw new Error(errorMessage);
    }

    const status = normalizeText(claimResponse.status).toUpperCase();
    if (!status) {
      return false;
    }

    return (
      status === 'SUCCESS' ||
      status === 'ELIGIBLE_FOR_ALL' ||
      status === 'DROP_INSTANCE_ALREADY_CLAIMED' ||
      status === 'CLAIMED'
    );
  }

  buildDirectoryPayload(game: string, slug: string, tags?: string[], broadcasterLanguages?: string[]) {
    return buildDirectoryPayload({ game, slug, tags, broadcasterLanguages });
  }

  async fetchDirectoryStreamers(
    gameName: string,
    categorySlug: string,
    language?: string,
  ): Promise<DirectoryStreamersResult> {
    return fetchDirectoryStreamers(this.transport, { gameName, categorySlug, language });
  }
}
