import { toSlug } from '../../shared/utils';
import { DropStatus, DropsSnapshot, TwitchDrop, TwitchGame, TwitchStreamer } from '../../types';
import { logDebug, logVerboseInfo, logVerboseWarn, logWarn } from '../logging';
import {
  buildClaimedRewardLookup,
  buildGlobalClaimedIdCounts,
  ClaimedRewardEntry,
  ClaimedRewardLookup,
  matchClaimedReward,
} from './claimed-rewards';
import { TwitchGqlTransport } from './gql';
import {
  computeExpiry,
  extractBenefitIds,
  extractBenefitNames,
  getFirstImageUrl,
  normalizeImageUrl,
  normalizeText,
  toIsoDate,
  toNumber,
} from './parsing';
import { TwitchSession } from './types';

const DROPS_TAG_ID = 'c2542d6d-cd10-4532-919b-3d19f30a768b';

const CURRENT_USER_QUERY = {
  operationName: 'CoreActionsCurrentUser',
  extensions: {
    persistedQuery: {
      version: 1,
      sha256Hash: '6b5b63a013cf66a995d61f71a508ab5c8e4473350c5d4136f846ba65e8101e95',
    },
  },
};

const VIEWER_DROPS_DASHBOARD_QUERY = {
  operationName: 'ViewerDropsDashboard',
  variables: {
    fetchRewardCampaigns: true,
  },
  extensions: {
    persistedQuery: {
      version: 1,
      sha256Hash: '5a4da2ab3d5b47c9f9ce864e727b2cb346af1e3ea8b897fe8f704a97ff017619',
    },
  },
};

const INVENTORY_QUERY = {
  operationName: 'Inventory',
  extensions: {
    persistedQuery: {
      version: 1,
      sha256Hash: 'd86775d0ef16a63a33ad52e80eaff963b2d5b72fada7c991504a57496e1d8e4b',
    },
  },
};

const CAMPAIGN_DETAILS_HASH = '039277bf98f3130929262cc7c6efd9c141ca3749cb6dca442fc8ead9a53f77c1';
const CAMPAIGN_DETAILS_BATCH_SIZE = 20;

const DIRECTORY_GAME_QUERY_HASH = '76cb069d835b8a02914c08dc42c421d0dafda8af5b113a3f19141824b901402f';
const CLAIM_DROP_REWARD_QUERY = {
  operationName: 'DropsPage_ClaimDropRewards',
  variables: {
    input: {
      dropInstanceID: '',
    },
  },
  extensions: {
    persistedQuery: {
      version: 1,
      sha256Hash: 'a455deea71bdc9015b78eb49f4acfbce8baa7ccbedd28e549bb025bd0f751930',
    },
  },
};

export type { ClaimedRewardEntry, ClaimedRewardLookup };
export {
  buildClaimedRewardLookup,
  buildGlobalClaimedIdCounts,
  computeExpiry,
  extractBenefitIds,
  extractBenefitNames,
  matchClaimedReward,
  normalizeImageUrl,
  normalizeText,
  toIsoDate,
  toNumber,
};

function normalizeDropStatus(progress: number, claimed: boolean, claimable: boolean): DropStatus {
  if (claimed) {
    return 'completed';
  }
  if (progress > 0 || claimable) {
    return 'active';
  }
  return 'pending';
}

interface InventoryDropState {
  campaignId: string;
  dropId: string;
  claimId?: string;
  requiredMinutes: number | null;
  currentMinutes: number;
  claimed: boolean;
  claimable: boolean;
  endsAt: string | null;
}

interface InventoryDropMaps {
  byCampaignDrop: Map<string, InventoryDropState>;
  byDropId: Map<string, InventoryDropState>;
}

function buildInventoryDropMaps(inventoryRaw: unknown): InventoryDropMaps {
  const byCampaignDrop = new Map<string, InventoryDropState>();
  const byDropId = new Map<string, InventoryDropState>();

  if (!inventoryRaw || typeof inventoryRaw !== 'object') {
    return { byCampaignDrop, byDropId };
  }

  const inventory = inventoryRaw as Record<string, unknown>;
  const campaigns = Array.isArray(inventory.dropCampaignsInProgress)
    ? (inventory.dropCampaignsInProgress as Array<Record<string, unknown>>)
    : [];

  campaigns.forEach((campaign) => {
    if (!campaign || typeof campaign !== 'object') {
      return;
    }

    const campaignId = normalizeText(campaign.id);
    if (!campaignId) {
      return;
    }

    const timeBasedDrops = Array.isArray(campaign.timeBasedDrops)
      ? (campaign.timeBasedDrops as Array<Record<string, unknown>>)
      : [];
    timeBasedDrops.forEach((drop) => {
      if (!drop || typeof drop !== 'object') {
        return;
      }

      const dropId = normalizeText(drop.id);
      if (!dropId) {
        return;
      }

      const self = (drop.self && typeof drop.self === 'object' ? drop.self : {}) as Record<string, unknown>;
      const requiredMinutes = toNumber(drop.requiredMinutesWatched ?? drop.requiredMinutes);
      const currentMinutes = toNumber(self.currentMinutesWatched ?? drop.currentMinutesWatched) ?? 0;
      const claimed = Boolean(self.isClaimed ?? drop.isClaimed);
      const claimable = Boolean(self.isClaimable ?? self.canClaim);
      const claimId = normalizeText(self.dropInstanceID) || normalizeText(self.dropInstanceId) || undefined;
      const endsAt = toIsoDate(drop.endAt);

      const state: InventoryDropState = {
        campaignId,
        dropId,
        claimId,
        requiredMinutes,
        currentMinutes: Math.max(0, currentMinutes),
        claimed,
        claimable,
        endsAt,
      };

      byCampaignDrop.set(`${campaignId}::${dropId}`, state);
      byDropId.set(dropId, state);
    });
  });

  return { byCampaignDrop, byDropId };
}

function isCampaignConnected(campaign: Record<string, unknown>): boolean {
  const self = campaign.self;
  if (!self || typeof self !== 'object') {
    return true;
  }
  const isConnected = (self as Record<string, unknown>).isAccountConnected;
  return isConnected !== false;
}

function isCampaignUsable(campaign: Record<string, unknown>): boolean {
  const status = normalizeText(campaign.status).toUpperCase();
  if (!status) {
    return true;
  }
  return status !== 'EXPIRED' && status !== 'INVALID' && status !== 'CLOSED';
}

function parseGameFromCampaign(campaign: Record<string, unknown>): TwitchGame | null {
  const gameRaw = campaign.game;
  if (!gameRaw || typeof gameRaw !== 'object') {
    return null;
  }

  const game = gameRaw as Record<string, unknown>;
  const campaignId = normalizeText(campaign.id);
  const gameName = normalizeText(game.displayName) || normalizeText(game.name);
  if (!gameName) {
    return null;
  }
  const campaignName =
    normalizeText(campaign.name) ||
    normalizeText(campaign.displayName) ||
    normalizeText(campaign.title) ||
    undefined;

  const categorySlug = normalizeText(game.slug) || undefined;
  const imageUrl = normalizeImageUrl(game.boxArtURL) || normalizeImageUrl(game.boxArtUrl);
  const endsAt = toIsoDate(campaign.endAt);
  const { expiresInMs, expiryStatus } = computeExpiry(endsAt);
  const isConnected = isCampaignConnected(campaign);

  const allowRaw = campaign.allow;
  let allowedChannels: string[] | null = null;
  if (allowRaw && typeof allowRaw === 'object') {
    const channelsRaw = Array.isArray((allowRaw as Record<string, unknown>).channels)
      ? ((allowRaw as Record<string, unknown>).channels as Array<unknown>)
      : [];
    if (channelsRaw.length > 0) {
      allowedChannels = channelsRaw
        .map((ch) => {
          if (!ch || typeof ch !== 'object') return '';
          return typeof (ch as Record<string, unknown>).name === 'string'
            ? ((ch as Record<string, unknown>).name as string).trim().toLowerCase()
            : '';
        })
        .filter((name) => name.length > 0);
      if (allowedChannels.length === 0) allowedChannels = null;
    }
  }
  logVerboseInfo(
    `[parseGameFromCampaign] game="${gameName}" campaign="${campaignId}" campaignName="${campaignName ?? ''}" allowedChannels=${allowedChannels ? JSON.stringify(allowedChannels) : 'null (any channel)'}`,
  );

  return {
    id: campaignId ? `campaign-${campaignId}` : `game-${toSlug(gameName)}`,
    name: gameName,
    displayName: gameName,
    campaignName,
    imageUrl,
    categorySlug: categorySlug || undefined,
    campaignId: campaignId || undefined,
    endsAt,
    expiresInMs,
    expiryStatus,
    dropCount: 0,
    isConnected,
    allowedChannels,
  };
}

function parseCampaignDrops(
  campaign: Record<string, unknown>,
  game: TwitchGame,
  inventoryMaps: InventoryDropMaps,
  claimedRewards: ClaimedRewardLookup,
  globalClaimedIdCounts: Set<string>,
): TwitchDrop[] {
  const campaignId = normalizeText(campaign.id) || game.campaignId || '';
  const campaignEndsAt = toIsoDate(campaign.endAt);
  const timeBasedDrops = Array.isArray(campaign.timeBasedDrops)
    ? (campaign.timeBasedDrops as Array<Record<string, unknown>>)
    : [];
  const gameClaimedRewards = claimedRewards.get(game.name.toLowerCase());

  const parsedDrops = timeBasedDrops.map((drop, index) => {
    const self = (drop.self && typeof drop.self === 'object' ? drop.self : {}) as Record<string, unknown>;
    const parsedDropId = normalizeText(drop.id);
    const inventoryState =
      inventoryMaps.byCampaignDrop.get(`${campaignId}::${parsedDropId}`) ??
      (parsedDropId ? inventoryMaps.byDropId.get(parsedDropId) : undefined);
    const claimId =
      inventoryState?.claimId || normalizeText(self.dropInstanceID) || normalizeText(self.dropInstanceId);
    const requiredMinutes =
      inventoryState?.requiredMinutes ?? toNumber(drop.requiredMinutesWatched ?? drop.requiredMinutes);
    const currentMinutes =
      inventoryState?.currentMinutes ??
      toNumber(self.currentMinutesWatched ?? drop.currentMinutesWatched) ??
      0;
    const benefitNames = extractBenefitNames(drop);
    const benefitIds = extractBenefitIds(drop);
    const { idMatch, nameMatch, globalIdMatch } = matchClaimedReward(
      benefitIds,
      benefitNames,
      gameClaimedRewards,
      globalClaimedIdCounts,
    );
    const claimedFromGameEvents = idMatch || nameMatch || globalIdMatch;
    const claimedFromInventory = inventoryState?.claimed ?? Boolean(self.isClaimed ?? drop.isClaimed);
    const claimed = claimedFromGameEvents || claimedFromInventory;
    logVerboseInfo(
      `[parseCampaignDrops] drop="${normalizeText(drop.name)}" game="${game.name}" benefitIds=[${benefitIds.join(', ')}] benefitNames=[${benefitNames.join(', ')}] idMatch=${idMatch} nameMatch=${nameMatch} globalIdMatch=${globalIdMatch} claimedFromGameEvents=${claimedFromGameEvents} claimedFromInventory=${claimedFromInventory} claimed=${claimed} hasGameClaimedRewards=${gameClaimedRewards != null}`,
    );
    const claimableFromApi = inventoryState?.claimable ?? Boolean(self.isClaimable ?? self.canClaim);
    const claimableFromProgress = Boolean(
      !claimed && requiredMinutes !== null && requiredMinutes > 0 && currentMinutes >= requiredMinutes,
    );
    const hasDropInstance = Boolean(claimId) && !claimed;
    const claimable = claimableFromApi || claimableFromProgress || hasDropInstance;
    const progress =
      claimed || claimable
        ? 100
        : requiredMinutes && requiredMinutes > 0
          ? Math.max(0, Math.min(100, Math.floor((currentMinutes / requiredMinutes) * 100)))
          : 0;

    const remainingMinutes =
      claimed || claimable || requiredMinutes === null
        ? 0
        : Math.max(0, Math.round(requiredMinutes - currentMinutes));

    const dropId = parsedDropId || claimId || `${game.id}-drop-${index + 1}`;

    const name = normalizeText(drop.name) || `Drop ${index + 1}`;
    const imageUrl = normalizeImageUrl(getFirstImageUrl(drop)) || game.imageUrl;
    const endsAt = inventoryState?.endsAt ?? toIsoDate(drop.endAt) ?? campaignEndsAt;

    // Drops with no watch-time requirement are not farmable (e.g. sub-only rewards
    // that the Twitch API places in timeBasedDrops instead of eventBasedDrops)
    const isFarmable = requiredMinutes !== null && requiredMinutes > 0;

    return {
      id: dropId,
      claimId: claimId || undefined,
      name,
      gameId: game.id,
      gameName: game.name,
      imageUrl,
      categorySlug: game.categorySlug,
      progress,
      currentMinutes,
      claimed,
      claimable,
      campaignId: campaignId || undefined,
      endsAt,
      expiresInMs: computeExpiry(endsAt).expiresInMs,
      status: normalizeDropStatus(progress, claimed, claimable),
      requiredMinutes,
      remainingMinutes,
      progressSource: 'campaign',
      ...(!isFarmable && { dropType: 'event-based' as const }),
    } satisfies TwitchDrop;
  });

  return parsedDrops;
}

function parseEventBasedDrops(
  campaign: Record<string, unknown>,
  game: TwitchGame,
  claimedRewards: ClaimedRewardLookup,
  globalClaimedIdCounts: Set<string>,
): TwitchDrop[] {
  const campaignId = normalizeText(campaign.id) || game.campaignId || '';
  const campaignEndsAt = toIsoDate(campaign.endAt);
  const eventBasedDrops = Array.isArray(campaign.eventBasedDrops)
    ? (campaign.eventBasedDrops as Array<Record<string, unknown>>)
    : [];
  const gameClaimedRewards = claimedRewards.get(game.name.toLowerCase());

  return eventBasedDrops.map((drop, index) => {
    const parsedDropId = normalizeText(drop.id);
    const benefitNames = extractBenefitNames(drop);
    const benefitIds = extractBenefitIds(drop);
    const { idMatch, nameMatch, globalIdMatch } = matchClaimedReward(
      benefitIds,
      benefitNames,
      gameClaimedRewards,
      globalClaimedIdCounts,
    );
    const claimed = idMatch || nameMatch || globalIdMatch;
    logVerboseInfo(
      `[parseEventBasedDrops] drop="${normalizeText(drop.name)}" game="${game.name}" benefitIds=[${benefitIds.join(', ')}] benefitNames=[${benefitNames.join(', ')}] idMatch=${idMatch} nameMatch=${nameMatch} globalIdMatch=${globalIdMatch} claimed=${claimed}`,
    );

    const dropId = parsedDropId || `${game.id}-event-drop-${index + 1}`;
    const name = normalizeText(drop.name) || `Event Drop ${index + 1}`;
    const imageUrl = normalizeImageUrl(getFirstImageUrl(drop)) || game.imageUrl;
    const endsAt = toIsoDate(drop.endAt) ?? campaignEndsAt;
    const progress = claimed ? 100 : 0;

    return {
      id: dropId,
      name,
      gameId: game.id,
      gameName: game.name,
      imageUrl,
      categorySlug: game.categorySlug,
      progress,
      currentMinutes: 0,
      claimed,
      claimable: false,
      campaignId: campaignId || undefined,
      endsAt,
      expiresInMs: computeExpiry(endsAt).expiresInMs,
      status: normalizeDropStatus(progress, claimed, false),
      requiredMinutes: null,
      remainingMinutes: null,
      progressSource: 'campaign',
      dropType: 'event-based',
    } satisfies TwitchDrop;
  });
}

function parseViewerCount(node: Record<string, unknown>): number {
  const raw = toNumber(node.viewersCount ?? node.viewerCount ?? node.viewers) ?? Number.MAX_SAFE_INTEGER;
  return Math.max(0, Math.round(raw));
}

export function normalizeStreamerLanguage(value: unknown): string | undefined {
  const normalized = normalizeText(value).toLowerCase().replace(/_/g, '-');
  if (!normalized) {
    return undefined;
  }
  const [primary] = normalized.split('-');
  return /^[a-z]{2,3}$/.test(primary) ? primary : undefined;
}

function normalizeLanguageForApi(storedLanguage: string): string {
  return storedLanguage.toUpperCase();
}

type DirectoryStreamersResult = TwitchStreamer[] & { languageFilterApplied: boolean };

function withLanguageFilterApplied(
  streamers: TwitchStreamer[],
  languageFilterApplied: boolean,
): DirectoryStreamersResult {
  return Object.assign(streamers, { languageFilterApplied });
}

function extractBroadcaster(node: Record<string, unknown>): { login: string; displayName: string } | null {
  const broadcaster = node.broadcaster;
  if (!broadcaster || typeof broadcaster !== 'object') {
    return null;
  }
  const payload = broadcaster as Record<string, unknown>;
  const login = normalizeText(payload.login).toLowerCase();
  const displayName = normalizeText(payload.displayName) || login;
  if (!login) {
    return null;
  }
  return { login, displayName };
}

export function extractBroadcasterLanguage(node: Record<string, unknown>): string | undefined {
  const broadcaster =
    node.broadcaster && typeof node.broadcaster === 'object'
      ? (node.broadcaster as Record<string, unknown>)
      : null;
  const broadcasterSettings =
    broadcaster?.broadcastSettings && typeof broadcaster.broadcastSettings === 'object'
      ? (broadcaster.broadcastSettings as Record<string, unknown>)
      : null;

  return normalizeStreamerLanguage(
    broadcasterSettings?.language ??
      broadcasterSettings?.broadcastLanguage ??
      broadcaster?.broadcastLanguage ??
      broadcaster?.primaryBroadcastLanguage ??
      broadcaster?.language ??
      node.broadcasterLanguage ??
      node.broadcastLanguage ??
      node.language ??
      node.lang,
  );
}

export class TwitchApiClient {
  private readonly transport: TwitchGqlTransport;
  private readonly session: TwitchSession;

  constructor(session: TwitchSession) {
    this.transport = new TwitchGqlTransport(session);
    this.session = session;
  }

  async fetchCurrentUserId(): Promise<string | null> {
    const data = await this.transport.postAuthorized<{ currentUser?: { id?: string } }>(CURRENT_USER_QUERY);
    const userId = data.currentUser?.id;
    return typeof userId === 'string' && userId.trim() ? userId.trim() : null;
  }

  private buildCampaignDetailsQuery(campaignId: string): Record<string, unknown> {
    return {
      operationName: 'DropCampaignDetails',
      variables: {
        dropID: campaignId,
        channelLogin: this.session.userId || '',
      },
      extensions: {
        persistedQuery: {
          version: 1,
          sha256Hash: CAMPAIGN_DETAILS_HASH,
        },
      },
    };
  }

  private async fetchCampaignDetailsBatch(
    campaignIds: string[],
  ): Promise<Map<string, Record<string, unknown>>> {
    const detailsMap = new Map<string, Record<string, unknown>>();
    for (let i = 0; i < campaignIds.length; i += CAMPAIGN_DETAILS_BATCH_SIZE) {
      const chunk = campaignIds.slice(i, i + CAMPAIGN_DETAILS_BATCH_SIZE);
      const queries = chunk.map((id) => this.buildCampaignDetailsQuery(id));
      const results = await this.transport.postAuthorizedBatch<{
        user?: { dropCampaign?: Record<string, unknown> };
      }>(queries);
      results.forEach((result) => {
        const campaign = result.data?.user?.dropCampaign;
        if (campaign && typeof campaign === 'object') {
          const id = normalizeText(campaign.id);
          if (id) {
            detailsMap.set(id, campaign);
          }
        }
      });
    }
    return detailsMap;
  }

  async fetchDropsSnapshot(): Promise<DropsSnapshot> {
    const [dashboardData, inventoryData] = await Promise.all([
      this.transport.postAuthorized<{ currentUser?: { dropCampaigns?: Array<Record<string, unknown>> } }>(
        VIEWER_DROPS_DASHBOARD_QUERY,
      ),
      this.transport
        .postAuthorized<{ currentUser?: { inventory?: Record<string, unknown> } }>(INVENTORY_QUERY)
        .catch((err: unknown) => {
          logWarn('[TwitchApiClient] Inventory fetch failed, proceeding without inventory:', String(err));
          return { currentUser: { inventory: null } };
        }),
    ]);

    const campaigns = dashboardData.currentUser?.dropCampaigns ?? [];
    const inventoryRaw = inventoryData.currentUser?.inventory;
    // Debug: log raw inventory structure
    if (inventoryRaw && typeof inventoryRaw === 'object') {
      const inv = inventoryRaw as Record<string, unknown>;
      const keys = Object.keys(inv);
      const gameEventDropsRaw = inv.gameEventDrops;
      const gameEventDropsCount = Array.isArray(gameEventDropsRaw) ? gameEventDropsRaw.length : 'NOT_ARRAY';
      const campaignsInProgress = Array.isArray(inv.dropCampaignsInProgress)
        ? (inv.dropCampaignsInProgress as Array<Record<string, unknown>>)
        : [];
      logVerboseInfo(`[TwitchApiClient] Raw inventory keys: [${keys.join(', ')}]`);
      logVerboseInfo(
        `[TwitchApiClient] gameEventDrops: count=${gameEventDropsCount}, type=${typeof gameEventDropsRaw}, isNull=${gameEventDropsRaw === null}`,
      );
      // Log each in-progress campaign with claimed drops
      campaignsInProgress.forEach((c) => {
        if (!c || typeof c !== 'object') return;
        const cId = normalizeText(c.id);
        const cGame =
          c.game && typeof c.game === 'object'
            ? normalizeText((c.game as Record<string, unknown>).displayName) ||
              normalizeText((c.game as Record<string, unknown>).name)
            : '?';
        const timeBasedDrops = Array.isArray(c.timeBasedDrops)
          ? (c.timeBasedDrops as Array<Record<string, unknown>>)
          : [];
        timeBasedDrops.forEach((d) => {
          if (!d || typeof d !== 'object') return;
          const dId = normalizeText(d.id);
          const self = (d.self && typeof d.self === 'object' ? d.self : {}) as Record<string, unknown>;
          const isClaimed = Boolean(self.isClaimed ?? d.isClaimed);
          const currentMin = toNumber(self.currentMinutesWatched ?? d.currentMinutesWatched) ?? 0;
          const reqMin = toNumber(d.requiredMinutesWatched ?? d.requiredMinutes);
          logVerboseInfo(
            `[TwitchApiClient] InProgress campaign="${cId}" game="${cGame}" drop="${dId}" claimed=${isClaimed} progress=${currentMin}/${reqMin}`,
          );
        });
      });
    } else {
      logVerboseWarn(
        `[TwitchApiClient] inventoryRaw is ${inventoryRaw === null ? 'null' : typeof inventoryRaw}`,
      );
    }
    const inventoryMaps = buildInventoryDropMaps(inventoryRaw);
    const claimedRewards = buildClaimedRewardLookup(inventoryRaw);
    const globalClaimedIdCounts = buildGlobalClaimedIdCounts(inventoryRaw);
    logVerboseInfo(
      `[TwitchApiClient] Inventory maps: ${inventoryMaps.byCampaignDrop.size} campaign::drop entries, ${inventoryMaps.byDropId.size} drop entries, ${claimedRewards.size} games with claimed rewards, ${globalClaimedIdCounts.size} global claimed IDs`,
    );

    // Filter to usable (non-expired) campaigns — show all, not just connected ones
    const usableCampaigns = campaigns.filter((c) => c && typeof c === 'object' && isCampaignUsable(c));

    // Fetch detailed campaign data (with timeBasedDrops) for all usable campaigns
    const campaignIds = usableCampaigns.map((c) => normalizeText(c.id)).filter((id) => id.length > 0);

    const detailsMap =
      campaignIds.length > 0
        ? await this.fetchCampaignDetailsBatch(campaignIds)
        : new Map<string, Record<string, unknown>>();

    const games: TwitchGame[] = [];
    const drops: TwitchDrop[] = [];
    const campaignChannelsMap: Record<string, string[] | null> = {};

    usableCampaigns.forEach((campaign) => {
      // Merge campaign details (with timeBasedDrops) BEFORE parsing the game
      // so parseGameFromCampaign can access game.slug from DropCampaignDetails
      const campaignId = normalizeText(campaign.id);
      const details = campaignId ? detailsMap.get(campaignId) : undefined;
      const mergedCampaign = details ? { ...campaign, ...details } : campaign;

      const game = parseGameFromCampaign(mergedCampaign);
      if (!game) {
        return;
      }

      // Store allowed channels for this campaign
      if (campaignId) {
        campaignChannelsMap[campaignId] = game.allowedChannels ?? null;
      }

      const campaignDrops = parseCampaignDrops(
        mergedCampaign,
        game,
        inventoryMaps,
        claimedRewards,
        globalClaimedIdCounts,
      );

      // Parse event-based (subscribe to redeem) drops
      const hasEventDrops = Array.isArray(mergedCampaign.eventBasedDrops);
      const eventDropCount = hasEventDrops ? (mergedCampaign.eventBasedDrops as Array<unknown>).length : 0;
      logVerboseInfo(
        `[TwitchApiClient] Campaign "${game.name}" (${campaignId}) eventBasedDrops: exists=${hasEventDrops}, count=${eventDropCount}`,
      );
      const eventDrops = parseEventBasedDrops(mergedCampaign, game, claimedRewards, globalClaimedIdCounts);

      const allCampaignDrops = [...campaignDrops, ...eventDrops];
      // Only include game if campaign has at least one farmable drop
      const hasFarmableDrops = campaignDrops.some((d) => d.dropType !== 'event-based');
      if (hasFarmableDrops) {
        games.push({
          ...game,
          dropCount: allCampaignDrops.length,
        });
      }
      drops.push(...allCampaignDrops);
    });

    return {
      games,
      drops,
      campaignChannelsMap,
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
      return true;
    }

    const errorMessage = normalizeText(claimResponse.error?.message);
    if (errorMessage) {
      throw new Error(errorMessage);
    }

    const status = normalizeText(claimResponse.status).toUpperCase();
    if (!status) {
      return true;
    }

    return (
      status === 'SUCCESS' ||
      status === 'ELIGIBLE_FOR_ALL' ||
      status === 'DROP_INSTANCE_ALREADY_CLAIMED' ||
      status === 'CLAIMED'
    );
  }

  private buildDirectoryPayload(
    game: string,
    slug: string,
    tags?: string[],
    broadcasterLanguages?: string[],
  ) {
    return {
      operationName: 'DirectoryPage_Game',
      variables: {
        game: game.toLowerCase(),
        slug,
        options: {
          includeRestricted: ['SUB_ONLY_LIVE'],
          sort: 'VIEWER_COUNT',
          recommendationsContext: { platform: 'web' },
          requestID: 'JIRA-VXP-2397',
          ...(tags ? { tags } : {}),
          ...(broadcasterLanguages && broadcasterLanguages.length > 0 ? { broadcasterLanguages } : {}),
        },
        sortTypeIsRecency: false,
        includeCostreaming: true,
        limit: 30,
      },
      extensions: {
        persistedQuery: {
          version: 1,
          sha256Hash: DIRECTORY_GAME_QUERY_HASH,
        },
      },
    };
  }

  private parseDirectoryEdges(edges: Array<{ node?: Record<string, unknown> }>): TwitchStreamer[] {
    const byChannel = new Map<string, TwitchStreamer>();

    edges.forEach((edge) => {
      const node = edge?.node;
      if (!node || typeof node !== 'object') {
        return;
      }

      const broadcaster = extractBroadcaster(node);
      if (!broadcaster) {
        return;
      }

      const candidate: TwitchStreamer = {
        id: broadcaster.login,
        name: broadcaster.login,
        displayName: broadcaster.displayName || broadcaster.login,
        isLive: true,
        viewerCount: parseViewerCount(node),
        broadcasterLanguage: extractBroadcasterLanguage(node),
        thumbnailUrl: normalizeImageUrl((node as Record<string, unknown>).previewImageURL),
      };

      const existing = byChannel.get(candidate.name);
      if (
        !existing ||
        (candidate.viewerCount ?? Number.MAX_SAFE_INTEGER) < (existing.viewerCount ?? Number.MAX_SAFE_INTEGER)
      ) {
        byChannel.set(candidate.name, candidate);
      }
    });

    return Array.from(byChannel.values());
  }

  private async fetchDirectoryEdges(
    game: string,
    slug: string,
    tags?: string[],
    broadcasterLanguages?: string[],
  ): Promise<Array<{ node?: Record<string, unknown> }>> {
    const payload = this.buildDirectoryPayload(game, slug, tags, broadcasterLanguages);
    const data = await this.transport.post<{
      game?: { streams?: { edges?: Array<{ node?: Record<string, unknown> }> } };
    }>(payload);
    return data.game?.streams?.edges ?? [];
  }

  async fetchDirectoryStreamers(
    gameName: string,
    categorySlug: string,
    language?: string,
  ): Promise<DirectoryStreamersResult> {
    const slug = normalizeText(categorySlug) || toSlug(gameName);
    const game = normalizeText(gameName) || slug;

    if (language) {
      const normalizedLanguage = normalizeLanguageForApi(language);
      const filteredEdges = await this.fetchDirectoryEdges(game, slug, [DROPS_TAG_ID], [normalizedLanguage]);
      const filteredStreamers = this.parseDirectoryEdges(filteredEdges);

      if (filteredStreamers.length > 0) {
        return withLanguageFilterApplied(filteredStreamers, true);
      }

      logDebug('Language filter returned 0 results, falling back to unfiltered', { language });
    }

    const taggedEdges = await this.fetchDirectoryEdges(game, slug, [DROPS_TAG_ID]);
    const taggedStreamers = this.parseDirectoryEdges(taggedEdges);

    if (taggedStreamers.length === 0) {
      logWarn(`[TwitchApiClient] No drops-tagged streams found for "${game}" (slug: ${slug})`);
    }

    return withLanguageFilterApplied(taggedStreamers, false);
  }
}
