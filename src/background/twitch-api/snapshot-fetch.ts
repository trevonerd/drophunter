import type { DropsSnapshot } from '../../types';
import { logDebug, logVerboseWarn, logWarn } from '../logging';
import { fetchCampaignDetailsBatch } from './campaign-detail-batches';
import { extractCampaignRewardDrops } from './campaign-model';
import {
  buildClaimedRewardLookup,
  buildGlobalClaimedIdCounts,
  buildGlobalClaimedRewardEntry,
} from './claimed-rewards';
import { TwitchGqlTransport } from './gql';
import { buildInventoryDropMaps } from './inventory-drops';
import { normalizeText } from './parsing';
import { INVENTORY_QUERY, VIEWER_DROPS_DASHBOARD_QUERY } from './queries';
import {
  campaignDetailsVerified,
  composeDropsSnapshot,
  extractVerifiedCampaigns,
  hasVerifiedInventory,
  orderCampaignDetails,
  type SnapshotCompositionContext,
} from './snapshot-composition';
import type { TwitchSession } from './types';

export interface FetchDropsSnapshotOptions {
  readonly priorityGameIds?: readonly string[];
  readonly onProgress?: (snapshot: DropsSnapshot) => void | Promise<void>;
}

export interface SnapshotFetchRequest {
  readonly transport: TwitchGqlTransport;
  readonly session: TwitchSession;
  readonly campaignDetailsCache: Map<string, Record<string, unknown>>;
  readonly lastValidSnapshot: DropsSnapshot | null;
  readonly options: FetchDropsSnapshotOptions;
}

export interface SnapshotFetchResult {
  readonly snapshot: DropsSnapshot;
  readonly lastValidSnapshot: DropsSnapshot | null;
}

export async function fetchUncoalescedDropsSnapshot(
  request: SnapshotFetchRequest,
): Promise<SnapshotFetchResult> {
  let inventoryFetchSucceeded = true;
  const [dashboardData, inventoryData] = await Promise.all([
    request.transport.postAuthorized<{ currentUser?: { dropCampaigns?: Array<Record<string, unknown>> } }>(
      VIEWER_DROPS_DASHBOARD_QUERY,
    ),
    request.transport
      .postAuthorized<{ currentUser?: { inventory?: Record<string, unknown> } }>(INVENTORY_QUERY)
      .catch((error: unknown) => {
        inventoryFetchSucceeded = false;
        logWarn('[TwitchApiClient] Inventory fetch failed, proceeding without inventory:', String(error));
        return { currentUser: { inventory: null } };
      }),
  ]);
  const { campaigns, verified: dashboardVerified } = extractVerifiedCampaigns(dashboardData);
  const inventoryRaw = inventoryData.currentUser?.inventory;
  const inventoryVerified = inventoryFetchSucceeded && hasVerifiedInventory(inventoryRaw);
  if (inventoryRaw && typeof inventoryRaw === 'object' && !('dropCampaignsInProgress' in inventoryRaw)) {
    logVerboseWarn('[DropHunter] Expected dropCampaignsInProgress field in inventory response');
  } else if (!inventoryRaw || typeof inventoryRaw !== 'object') {
    logVerboseWarn(
      `[TwitchApiClient] inventoryRaw is ${inventoryRaw === null ? 'null' : typeof inventoryRaw}`,
    );
  }
  const inventoryMaps = buildInventoryDropMaps(inventoryRaw);
  const claimedRewards = buildClaimedRewardLookup(inventoryRaw);
  const globalClaimedRewards = buildGlobalClaimedRewardEntry(inventoryRaw);
  const globalClaimedIdCounts = buildGlobalClaimedIdCounts(inventoryRaw);
  const priorityGameIds = new Set((request.options.priorityGameIds ?? []).map(normalizeText).filter(Boolean));
  const usableCampaigns = orderCampaignDetails(campaigns, priorityGameIds);
  const campaignIds = usableCampaigns.map((campaign) => normalizeText(campaign.id)).filter(Boolean);
  const composition: SnapshotCompositionContext = {
    campaigns,
    usableCampaigns,
    dashboardCampaignIds: campaigns.map((campaign) => normalizeText(campaign.id)),
    inventoryVerified,
    inventoryMaps,
    claimedRewards,
    globalClaimedRewards,
  };
  const compose = (detailsMap: ReadonlyMap<string, Record<string, unknown>>, campaignsVerified = false) =>
    composeDropsSnapshot(composition, detailsMap, campaignsVerified);
  let progressTail = Promise.resolve();
  const emitProgress = async (detailsMap: ReadonlyMap<string, Record<string, unknown>>): Promise<void> => {
    if (!request.options.onProgress || detailsMap.size === 0) return;
    const snapshot = compose(detailsMap);
    if (snapshot.games.length === 0 && snapshot.drops.length === 0) return;
    progressTail = progressTail.then(() => request.options.onProgress?.(snapshot));
    await progressTail;
  };
  const campaignDetails =
    campaignIds.length > 0
      ? await fetchCampaignDetailsBatch(request.transport, {
          campaignIds,
          channelLogin: request.session.userId || '',
          cache: request.campaignDetailsCache,
          onProgress: (detailsMap) => emitProgress(detailsMap),
        })
      : { detailsMap: new Map<string, Record<string, unknown>>(), failedBatches: 0 };
  const hasDashboardRewardData = usableCampaigns.some(
    (campaign) => extractCampaignRewardDrops(campaign).length > 0,
  );
  if (
    campaignIds.length > 0 &&
    campaignDetails.failedBatches > 0 &&
    campaignDetails.detailsMap.size === 0 &&
    !hasDashboardRewardData
  ) {
    if (request.lastValidSnapshot) {
      return {
        snapshot: {
          ...request.lastValidSnapshot,
          inventoryVerified: false,
          campaignsVerified: false,
          authoritativeCampaignIds: undefined,
        },
        lastValidSnapshot: request.lastValidSnapshot,
      };
    }
    throw new Error('Twitch campaign details unavailable.');
  }
  const campaignsVerified =
    dashboardVerified &&
    inventoryVerified &&
    campaignDetailsVerified(
      usableCampaigns,
      campaignIds,
      campaignDetails.detailsMap,
      campaignDetails.failedBatches,
    );
  const snapshot = compose(campaignDetails.detailsMap, campaignsVerified);
  logDebug('Fetched drops snapshot', {
    campaigns: usableCampaigns.length,
    inventoryProgressDrops: inventoryMaps.byCampaignDrop.size,
    games: snapshot.games.length,
    drops: snapshot.drops.length,
    claimedRewardGames: claimedRewards.size,
    globalClaimedIds: globalClaimedIdCounts.size,
  });
  return {
    snapshot,
    lastValidSnapshot:
      snapshot.campaignsVerified && snapshot.games.length > 0 ? snapshot : request.lastValidSnapshot,
  };
}
