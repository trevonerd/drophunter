import { DropsSnapshot, DropStatus, TwitchDrop, TwitchGame, TwitchStreamer } from '../../types';
import { TwitchGqlTransport } from './gql';
import { TwitchSession } from './types';

const DROPS_TAG_ID = 'c2542d6d-cd10-4532-919b-3d19f30a768b';

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

  const categorySlug = toSlug(normalizeText(game.name) || displayName);
  const imageUrl = normalizeImageUrl(game.boxArtURL) || normalizeImageUrl(game.boxArtUrl);
  const endsAt = toIsoDate(campaign.endAt);
  const { expiresInMs, expiryStatus } = computeExpiry(endsAt);

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
  };
}

function parseCampaignDrops(campaign: Record<string, unknown>, game: TwitchGame, inventoryMaps: InventoryDropMaps): TwitchDrop[] {
  const campaignId = normalizeText(campaign.id) || game.campaignId || '';
  const campaignEndsAt = toIsoDate(campaign.endAt);
  const timeBasedDrops = Array.isArray(campaign.timeBasedDrops) ? (campaign.timeBasedDrops as Array<Record<string, unknown>>) : [];

  return timeBasedDrops.map((drop, index) => {
    const self = (drop.self && typeof drop.self === 'object' ? drop.self : {}) as Record<string, unknown>;
    const parsedDropId = normalizeText(drop.id);
    const inventoryState =
      inventoryMaps.byCampaignDrop.get(`${campaignId}::${parsedDropId}`) ??
      (parsedDropId ? inventoryMaps.byDropId.get(parsedDropId) : undefined);
    const claimId = inventoryState?.claimId || normalizeText(self.dropInstanceID) || normalizeText(self.dropInstanceId);
    const requiredMinutes = inventoryState?.requiredMinutes ?? toNumber(drop.requiredMinutesWatched ?? drop.requiredMinutes);
    const currentMinutes = inventoryState?.currentMinutes ?? (toNumber(self.currentMinutesWatched ?? drop.currentMinutesWatched) ?? 0);
    const claimed = inventoryState?.claimed ?? Boolean(self.isClaimed ?? drop.isClaimed);
    const claimableFromApi = inventoryState?.claimable ?? Boolean(self.isClaimable ?? self.canClaim);
    const claimableFromProgress = Boolean(!claimed && requiredMinutes !== null && requiredMinutes > 0 && currentMinutes >= requiredMinutes);
    const claimable = claimableFromApi || claimableFromProgress;
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

  constructor(session: TwitchSession) {
    this.transport = new TwitchGqlTransport(session);
  }

  async fetchDropsSnapshot(): Promise<DropsSnapshot> {
    const [dashboardData, inventoryData] = await Promise.all([
      this.transport.postAuthorized<{ currentUser?: { dropCampaigns?: Array<Record<string, unknown>> } }>(VIEWER_DROPS_DASHBOARD_QUERY),
      this.transport
        .postAuthorized<{ currentUser?: { inventory?: Record<string, unknown> } }>(INVENTORY_QUERY)
        .catch(() => ({ currentUser: { inventory: null } })),
    ]);

    const campaigns = dashboardData.currentUser?.dropCampaigns ?? [];
    const inventoryMaps = buildInventoryDropMaps(inventoryData.currentUser?.inventory);

    const games: TwitchGame[] = [];
    const drops: TwitchDrop[] = [];

    campaigns.forEach((campaign) => {
      if (!campaign || typeof campaign !== 'object') {
        return;
      }
      if (!isCampaignConnected(campaign) || !isCampaignUsable(campaign)) {
        return;
      }

      const game = parseGameFromCampaign(campaign);
      if (!game) {
        return;
      }

      const campaignDrops = parseCampaignDrops(campaign, game, inventoryMaps);
      games.push({
        ...game,
        dropCount: campaignDrops.length,
      });
      drops.push(...campaignDrops);
    });

    return {
      games,
      drops,
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

  async fetchDirectoryStreamers(gameName: string, categorySlug: string): Promise<TwitchStreamer[]> {
    const slug = normalizeText(categorySlug) || toSlug(gameName);
    const game = normalizeText(gameName) || slug;

    const payload = {
      operationName: 'DirectoryPage_Game',
      variables: {
        game: game.toLowerCase(),
        slug,
        options: {
          includeRestricted: ['SUB_ONLY_LIVE'],
          sort: 'VIEWER_COUNT',
          recommendationsContext: { platform: 'web' },
          requestID: 'JIRA-VXP-2397',
          tags: [DROPS_TAG_ID],
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

    const data = await this.transport.post<{ game?: { streams?: { edges?: Array<{ node?: Record<string, unknown> }> } } }>(payload);
    const edges = data.game?.streams?.edges ?? [];
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

      const title = normalizeText((node as Record<string, unknown>).title);
      if (!/\bdrops\b/i.test(title)) {
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
}
