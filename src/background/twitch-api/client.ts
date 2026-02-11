import { DropsSnapshot, DropStatus, TwitchDrop, TwitchGame, TwitchStreamer } from '../../types';
import { TwitchGqlTransport } from './gql';
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

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function toIsoDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function withBoxArtSize(url: string): string {
  return url.replace(/\{width\}/gi, '285').replace(/\{height\}/gi, '380');
}

function normalizeImageUrl(value: unknown): string {
  const raw = normalizeText(value);
  if (!raw) {
    return '';
  }
  if (raw.includes('{width}') || raw.includes('{height}')) {
    return withBoxArtSize(raw);
  }
  return raw;
}

function getFirstImageUrl(value: unknown, depth = 0): string {
  if (depth > 6 || value == null) {
    return '';
  }

  if (typeof value === 'string') {
    return value.startsWith('http') ? value : '';
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const fromItem = getFirstImageUrl(item, depth + 1);
      if (fromItem) {
        return fromItem;
      }
    }
    return '';
  }

  if (typeof value !== 'object') {
    return '';
  }

  const record = value as Record<string, unknown>;
  const priorityKeys = ['imageURL', 'imageUrl', 'boxArtURL', 'boxArtUrl', 'thumbnailURL', 'thumbnailUrl', 'url', 'src'];
  for (const key of priorityKeys) {
    const candidate = getFirstImageUrl(record[key], depth + 1);
    if (candidate) {
      return candidate;
    }
  }

  for (const key of Object.keys(record)) {
    const candidate = getFirstImageUrl(record[key], depth + 1);
    if (candidate) {
      return candidate;
    }
  }
  return '';
}

function computeExpiry(endsAt: string | null): { expiresInMs: number | null; expiryStatus: TwitchGame['expiryStatus'] } {
  if (!endsAt) {
    return { expiresInMs: null, expiryStatus: 'unknown' };
  }
  const expiresInMs = new Date(endsAt).getTime() - Date.now();
  if (!Number.isFinite(expiresInMs)) {
    return { expiresInMs: null, expiryStatus: 'unknown' };
  }
  if (expiresInMs <= 24 * 60 * 60 * 1000) {
    return { expiresInMs, expiryStatus: 'urgent' };
  }
  if (expiresInMs <= 72 * 60 * 60 * 1000) {
    return { expiresInMs, expiryStatus: 'warning' };
  }
  return { expiresInMs, expiryStatus: 'safe' };
}

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

    const timeBasedDrops = Array.isArray(campaign.timeBasedDrops) ? (campaign.timeBasedDrops as Array<Record<string, unknown>>) : [];
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

function extractBenefitNames(drop: Record<string, unknown>): string[] {
  const edges = Array.isArray(drop.benefitEdges) ? (drop.benefitEdges as Array<unknown>) : [];
  return edges
    .map((edge) => {
      if (!edge || typeof edge !== 'object') return '';
      const benefit = (edge as Record<string, unknown>).benefit;
      if (!benefit || typeof benefit !== 'object') return '';
      return normalizeText((benefit as Record<string, unknown>).name).toLowerCase();
    })
    .filter((name) => name.length > 0);
}

function extractBenefitIds(drop: Record<string, unknown>): string[] {
  const edges = Array.isArray(drop.benefitEdges) ? (drop.benefitEdges as Array<unknown>) : [];
  return edges
    .map((edge) => {
      if (!edge || typeof edge !== 'object') return '';
      const benefit = (edge as Record<string, unknown>).benefit;
      if (!benefit || typeof benefit !== 'object') return '';
      return normalizeText((benefit as Record<string, unknown>).id);
    })
    .filter((id) => id.length > 0);
}

/** Lookup of claimed rewards from inventory gameEventDrops, keyed by normalized game name */
interface ClaimedRewardEntry { nameCounts: Map<string, number>; idCounts: Map<string, number>; }
type ClaimedRewardLookup = Map<string, ClaimedRewardEntry>;

function buildClaimedRewardLookup(inventoryRaw: unknown): ClaimedRewardLookup {
  const lookup: ClaimedRewardLookup = new Map();

  if (!inventoryRaw || typeof inventoryRaw !== 'object') {
    return lookup;
  }

  const inventory = inventoryRaw as Record<string, unknown>;
  const gameEventDrops = Array.isArray(inventory.gameEventDrops)
    ? (inventory.gameEventDrops as Array<Record<string, unknown>>)
    : [];

  gameEventDrops.forEach((drop) => {
    if (!drop || typeof drop !== 'object') return;

    const gameObj = drop.game;
    if (!gameObj || typeof gameObj !== 'object') return;

    const gameRec = gameObj as Record<string, unknown>;
    const gameName = (normalizeText(gameRec.displayName) || normalizeText(gameRec.name)).toLowerCase();
    const rewardName = normalizeText(drop.name).toLowerCase();
    const benefitId = normalizeText(drop.id);

    if (!gameName || (!rewardName && !benefitId)) return;

    if (!lookup.has(gameName)) {
      lookup.set(gameName, { nameCounts: new Map(), idCounts: new Map() });
    }
    const entry = lookup.get(gameName)!;
    if (rewardName) entry.nameCounts.set(rewardName, (entry.nameCounts.get(rewardName) ?? 0) + 1);
    if (benefitId) entry.idCounts.set(benefitId, (entry.idCounts.get(benefitId) ?? 0) + 1);
    console.info(`[buildClaimedRewardLookup] game="${gameName}" claimedName="${rewardName}" benefitId="${benefitId}"`);
  });

  lookup.forEach((entry, gameName) => {
    const nameEntries = Array.from(entry.nameCounts.entries()).map(([n, c]) => `${n}(x${c})`).join(', ');
    const idEntries = Array.from(entry.idCounts.entries()).map(([id, c]) => `${id}(x${c})`).join(', ');
    console.info(`[buildClaimedRewardLookup] SUMMARY game="${gameName}" claimedNames=[${nameEntries}] claimedIdCounts=[${idEntries}]`);
  });

  return lookup;
}

/** Global (cross-game) benefit ID counts — fallback when game name doesn't match between campaign and inventory */
function buildGlobalClaimedIdCounts(inventoryRaw: unknown): Map<string, number> {
  const counts = new Map<string, number>();
  if (!inventoryRaw || typeof inventoryRaw !== 'object') return counts;
  const inventory = inventoryRaw as Record<string, unknown>;
  const gameEventDrops = Array.isArray(inventory.gameEventDrops)
    ? (inventory.gameEventDrops as Array<Record<string, unknown>>)
    : [];
  gameEventDrops.forEach((drop) => {
    if (!drop || typeof drop !== 'object') return;
    const benefitId = normalizeText(drop.id);
    if (benefitId) counts.set(benefitId, (counts.get(benefitId) ?? 0) + 1);
  });
  return counts;
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
  return status !== 'EXPIRED' && status !== 'INVALID';
}

function parseGameFromCampaign(campaign: Record<string, unknown>): TwitchGame | null {
  const gameRaw = campaign.game;
  if (!gameRaw || typeof gameRaw !== 'object') {
    return null;
  }

  const game = gameRaw as Record<string, unknown>;
  const campaignId = normalizeText(campaign.id);
  const displayName = normalizeText(game.displayName) || normalizeText(game.name);
  if (!displayName) {
    return null;
  }

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
          return (typeof (ch as Record<string, unknown>).name === 'string'
            ? ((ch as Record<string, unknown>).name as string).trim().toLowerCase() : '');
        })
        .filter((name) => name.length > 0);
      if (allowedChannels.length === 0) allowedChannels = null;
    }
  }
  console.info(`[parseGameFromCampaign] game="${displayName}" campaign="${campaignId}" allowedChannels=${allowedChannels ? JSON.stringify(allowedChannels) : 'null (any channel)'}`);

  return {
    id: campaignId ? `campaign-${campaignId}` : `game-${toSlug(displayName)}`,
    name: displayName,
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

function parseCampaignDrops(campaign: Record<string, unknown>, game: TwitchGame, inventoryMaps: InventoryDropMaps, claimedRewards: ClaimedRewardLookup, globalClaimedIdCounts: Map<string, number>): TwitchDrop[] {
  const campaignId = normalizeText(campaign.id) || game.campaignId || '';
  const campaignEndsAt = toIsoDate(campaign.endAt);
  const timeBasedDrops = Array.isArray(campaign.timeBasedDrops) ? (campaign.timeBasedDrops as Array<Record<string, unknown>>) : [];
  const gameClaimedRewards = claimedRewards.get(game.name.toLowerCase());

  const parsedDrops = timeBasedDrops.map((drop, index) => {
    const self = (drop.self && typeof drop.self === 'object' ? drop.self : {}) as Record<string, unknown>;
    const parsedDropId = normalizeText(drop.id);
    const inventoryState =
      inventoryMaps.byCampaignDrop.get(`${campaignId}::${parsedDropId}`) ??
      (parsedDropId ? inventoryMaps.byDropId.get(parsedDropId) : undefined);
    const claimId = inventoryState?.claimId || normalizeText(self.dropInstanceID) || normalizeText(self.dropInstanceId);
    const requiredMinutes = inventoryState?.requiredMinutes ?? toNumber(drop.requiredMinutesWatched ?? drop.requiredMinutes);
    const currentMinutes = inventoryState?.currentMinutes ?? (toNumber(self.currentMinutesWatched ?? drop.currentMinutesWatched) ?? 0);
    // Check if any of this drop's benefit rewards appear in the user's claimed gameEventDrops
    const benefitNames = extractBenefitNames(drop);
    const benefitIds = extractBenefitIds(drop);
    // ID match with consumption: decrement count so duplicate-ID drops aren't all marked claimed
    let idMatch = false;
    if (gameClaimedRewards != null) {
      for (const id of benefitIds) {
        const remaining = gameClaimedRewards.idCounts.get(id) ?? 0;
        if (remaining > 0) {
          idMatch = true;
          gameClaimedRewards.idCounts.set(id, remaining - 1);
          break;
        }
      }
    }
    // Name match: only if idMatch didn't already consume, to avoid double-counting
    let nameMatch = false;
    if (!idMatch && gameClaimedRewards != null) {
      for (const name of benefitNames) {
        const remaining = gameClaimedRewards.nameCounts.get(name) ?? 0;
        if (remaining > 0) {
          nameMatch = true;
          gameClaimedRewards.nameCounts.set(name, remaining - 1);
          break;
        }
      }
    }
    // Global fallback: when per-game lookup misses (game name mismatch), check cross-game counts with consumption
    let globalIdMatch = false;
    if (!idMatch && !nameMatch && gameClaimedRewards == null) {
      for (const id of benefitIds) {
        const remaining = globalClaimedIdCounts.get(id) ?? 0;
        if (remaining > 0) {
          globalIdMatch = true;
          globalClaimedIdCounts.set(id, remaining - 1);
          break;
        }
      }
    }
    const claimedFromGameEvents = idMatch || nameMatch || globalIdMatch;
    const claimedFromInventory = inventoryState?.claimed ?? Boolean(self.isClaimed ?? drop.isClaimed);
    const claimed = claimedFromGameEvents || claimedFromInventory;
    console.info(`[parseCampaignDrops] drop="${normalizeText(drop.name)}" game="${game.name}" benefitIds=[${benefitIds.join(', ')}] benefitNames=[${benefitNames.join(', ')}] idMatch=${idMatch} nameMatch=${nameMatch} globalIdMatch=${globalIdMatch} claimedFromGameEvents=${claimedFromGameEvents} claimedFromInventory=${claimedFromInventory} claimed=${claimed} hasGameClaimedRewards=${gameClaimedRewards != null}`);
    const claimableFromApi = inventoryState?.claimable ?? Boolean(self.isClaimable ?? self.canClaim);
    const claimableFromProgress = Boolean(!claimed && requiredMinutes !== null && requiredMinutes > 0 && currentMinutes >= requiredMinutes);
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

    return {
      id: dropId,
      claimId: claimId || undefined,
      name,
      gameId: game.id,
      gameName: game.name,
      imageUrl,
      categorySlug: game.categorySlug,
      progress,
      claimed,
      claimable,
      campaignId: campaignId || undefined,
      endsAt,
      expiresInMs: computeExpiry(endsAt).expiresInMs,
      status: normalizeDropStatus(progress, claimed, claimable),
      requiredMinutes,
      remainingMinutes,
      progressSource: 'campaign',
    } satisfies TwitchDrop;
  });

  return parsedDrops;
}

function parseViewerCount(node: Record<string, unknown>): number {
  const raw = toNumber(node.viewersCount ?? node.viewerCount ?? node.viewers) ?? Number.MAX_SAFE_INTEGER;
  return Math.max(0, Math.round(raw));
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
      this.transport.postAuthorized<{ currentUser?: { dropCampaigns?: Array<Record<string, unknown>> } }>(VIEWER_DROPS_DASHBOARD_QUERY),
      this.transport
        .postAuthorized<{ currentUser?: { inventory?: Record<string, unknown> } }>(INVENTORY_QUERY)
        .catch(() => ({ currentUser: { inventory: null } })),
    ]);

    const campaigns = dashboardData.currentUser?.dropCampaigns ?? [];
    const inventoryRaw = inventoryData.currentUser?.inventory;
    // Debug: log raw inventory structure
    if (inventoryRaw && typeof inventoryRaw === 'object') {
      const inv = inventoryRaw as Record<string, unknown>;
      const keys = Object.keys(inv);
      const gameEventDropsRaw = inv.gameEventDrops;
      const gameEventDropsCount = Array.isArray(gameEventDropsRaw) ? gameEventDropsRaw.length : 'NOT_ARRAY';
      const campaignsInProgress = Array.isArray(inv.dropCampaignsInProgress) ? inv.dropCampaignsInProgress as Array<Record<string, unknown>> : [];
      console.info(`[TwitchApiClient] Raw inventory keys: [${keys.join(', ')}]`);
      console.info(`[TwitchApiClient] gameEventDrops: count=${gameEventDropsCount}, type=${typeof gameEventDropsRaw}, isNull=${gameEventDropsRaw === null}`);
      // Log each in-progress campaign with claimed drops
      campaignsInProgress.forEach((c) => {
        if (!c || typeof c !== 'object') return;
        const cId = normalizeText(c.id);
        const cGame = c.game && typeof c.game === 'object' ? normalizeText((c.game as Record<string, unknown>).displayName) || normalizeText((c.game as Record<string, unknown>).name) : '?';
        const timeBasedDrops = Array.isArray(c.timeBasedDrops) ? c.timeBasedDrops as Array<Record<string, unknown>> : [];
        timeBasedDrops.forEach((d) => {
          if (!d || typeof d !== 'object') return;
          const dId = normalizeText(d.id);
          const self = (d.self && typeof d.self === 'object' ? d.self : {}) as Record<string, unknown>;
          const isClaimed = Boolean(self.isClaimed ?? d.isClaimed);
          const currentMin = toNumber(self.currentMinutesWatched ?? d.currentMinutesWatched) ?? 0;
          const reqMin = toNumber(d.requiredMinutesWatched ?? d.requiredMinutes);
          console.info(`[TwitchApiClient] InProgress campaign="${cId}" game="${cGame}" drop="${dId}" claimed=${isClaimed} progress=${currentMin}/${reqMin}`);
        });
      });
    } else {
      console.warn(`[TwitchApiClient] inventoryRaw is ${inventoryRaw === null ? 'null' : typeof inventoryRaw}`);
    }
    const inventoryMaps = buildInventoryDropMaps(inventoryRaw);
    const claimedRewards = buildClaimedRewardLookup(inventoryRaw);
    const globalClaimedIdCounts = buildGlobalClaimedIdCounts(inventoryRaw);
    console.info(`[TwitchApiClient] Inventory maps: ${inventoryMaps.byCampaignDrop.size} campaign::drop entries, ${inventoryMaps.byDropId.size} drop entries, ${claimedRewards.size} games with claimed rewards, ${globalClaimedIdCounts.size} global claimed IDs`);

    // Filter to usable (non-expired) campaigns — show all, not just connected ones
    const usableCampaigns = campaigns.filter(
      (c) => c && typeof c === 'object' && isCampaignUsable(c),
    );

    // Fetch detailed campaign data (with timeBasedDrops) for all usable campaigns
    const campaignIds = usableCampaigns
      .map((c) => normalizeText(c.id))
      .filter((id) => id.length > 0);

    const detailsMap = campaignIds.length > 0
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
      const mergedCampaign = details
        ? { ...campaign, ...details }
        : campaign;

      const game = parseGameFromCampaign(mergedCampaign);
      if (!game) {
        return;
      }

      // Store allowed channels for this campaign
      if (campaignId) {
        campaignChannelsMap[campaignId] = game.allowedChannels ?? null;
      }

      const campaignDrops = parseCampaignDrops(mergedCampaign, game, inventoryMaps, claimedRewards, globalClaimedIdCounts);
      games.push({
        ...game,
        dropCount: campaignDrops.length,
      });
      drops.push(...campaignDrops);
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

  private buildDirectoryPayload(game: string, slug: string, tags?: string[]) {
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
        thumbnailUrl: normalizeImageUrl((node as Record<string, unknown>).previewImageURL),
      };

      const existing = byChannel.get(candidate.name);
      if (!existing || (candidate.viewerCount ?? Number.MAX_SAFE_INTEGER) < (existing.viewerCount ?? Number.MAX_SAFE_INTEGER)) {
        byChannel.set(candidate.name, candidate);
      }
    });

    return Array.from(byChannel.values())
      .sort((a, b) => (a.viewerCount ?? Number.MAX_SAFE_INTEGER) - (b.viewerCount ?? Number.MAX_SAFE_INTEGER))
      .slice(0, 25);
  }

  async fetchDirectoryStreamers(gameName: string, categorySlug: string): Promise<TwitchStreamer[]> {
    const slug = normalizeText(categorySlug) || toSlug(gameName);
    const game = normalizeText(gameName) || slug;

    // First try with drops tag filter
    const taggedPayload = this.buildDirectoryPayload(game, slug, [DROPS_TAG_ID]);
    const taggedData = await this.transport.post<{ game?: { streams?: { edges?: Array<{ node?: Record<string, unknown> }> } } }>(taggedPayload);
    const taggedEdges = taggedData.game?.streams?.edges ?? [];
    const taggedStreamers = this.parseDirectoryEdges(taggedEdges);

    if (taggedStreamers.length === 0) {
      console.warn(`[TwitchApiClient] No drops-tagged streams found for "${game}" (slug: ${slug})`);
    }
    return taggedStreamers;
  }
}
