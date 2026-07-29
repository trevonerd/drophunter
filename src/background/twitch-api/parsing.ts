import type { RewardAcquisitionMethod, RewardKind, TwitchGame } from '../../types/index.ts';

const MAX_IMAGE_SEARCH_DEPTH = 6;

export function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function extractRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (item): item is Record<string, unknown> =>
      item !== null && typeof item === 'object' && !Array.isArray(item),
  );
}

export function toNumber(value: unknown): number | null {
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

export function toIsoDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function withBoxArtSize(url: string): string {
  return url.replace(/\{width\}/gi, '285').replace(/\{height\}/gi, '380');
}

export function normalizeImageUrl(value: unknown): string {
  const raw = normalizeText(value);
  if (!raw) {
    return '';
  }
  if (raw.includes('{width}') || raw.includes('{height}')) {
    return withBoxArtSize(raw);
  }
  return raw;
}

export function getFirstImageUrl(value: unknown, depth = 0): string {
  if (depth > MAX_IMAGE_SEARCH_DEPTH || value == null) {
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
  const priorityKeys = [
    'imageURL',
    'imageUrl',
    'boxArtURL',
    'boxArtUrl',
    'thumbnailURL',
    'thumbnailUrl',
    'url',
    'src',
  ];
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

export function computeExpiry(endsAt: string | null): {
  expiresInMs: number | null;
  expiryStatus: TwitchGame['expiryStatus'];
} {
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

function extractBenefitProperty(drop: Record<string, unknown>, key: 'name' | 'id'): string[] {
  const edges = Array.isArray(drop.benefitEdges) ? (drop.benefitEdges as Array<unknown>) : [];
  return edges
    .map((edge) => {
      if (!edge || typeof edge !== 'object') return '';
      const benefit = (edge as Record<string, unknown>).benefit;
      if (!benefit || typeof benefit !== 'object') return '';
      const value = normalizeText((benefit as Record<string, unknown>)[key]);
      return key === 'name' ? value.toLowerCase() : value;
    })
    .filter((value) => value.length > 0);
}

export function extractBenefitNames(drop: Record<string, unknown>): string[] {
  return extractBenefitProperty(drop, 'name');
}

export function extractBenefitIds(drop: Record<string, unknown>): string[] {
  return extractBenefitProperty(drop, 'id');
}

export function extractBenefitDistributionTypes(drop: Record<string, unknown>): string[] {
  const edges = Array.isArray(drop.benefitEdges) ? (drop.benefitEdges as Array<unknown>) : [];
  return edges
    .map((edge) => {
      if (!edge || typeof edge !== 'object') return '';
      const benefit = (edge as Record<string, unknown>).benefit;
      if (!benefit || typeof benefit !== 'object') return '';
      return normalizeText((benefit as Record<string, unknown>).distributionType).toUpperCase();
    })
    .filter((value) => value.length > 0);
}

export type RewardCampaignCandidate = {
  readonly gameName: string;
  readonly campaignIdentity: string;
  readonly benefitIds: readonly string[];
};

export function rewardBenefitKey(gameName: string, benefitId: string): string {
  return `${normalizeText(gameName).toLowerCase()}\u0000${normalizeText(benefitId)}`;
}

export function buildConflictedRewardBenefitKeys(
  candidates: readonly RewardCampaignCandidate[],
): ReadonlySet<string> {
  const firstCampaignByBenefit = new Map<string, string>();
  const conflicts = new Set<string>();

  for (const candidate of candidates) {
    for (const benefitId of candidate.benefitIds) {
      const key = rewardBenefitKey(candidate.gameName, benefitId);
      const firstCampaign = firstCampaignByBenefit.get(key);
      if (firstCampaign === undefined) {
        firstCampaignByBenefit.set(key, candidate.campaignIdentity);
      } else if (firstCampaign !== candidate.campaignIdentity) {
        conflicts.add(key);
      }
    }
  }

  return conflicts;
}

export type RewardAcquisitionFallback = 'subscription' | 'unknown';

export function classifyRewardAcquisitionMethod(
  requiredMinutes: number | null,
  fallback: RewardAcquisitionFallback,
): RewardAcquisitionMethod {
  if (requiredMinutes === 0) return 'subscription';
  if (requiredMinutes !== null && Number.isFinite(requiredMinutes) && requiredMinutes > 0) {
    return 'watch-time';
  }
  return fallback;
}

export function classifyRewardKind(distributionTypes: readonly string[]): RewardKind {
  const normalizedTypes = [
    ...new Set(distributionTypes.map((value) => normalizeText(value).toUpperCase()).filter(Boolean)),
  ];
  if (normalizedTypes.length !== 1) return 'unknown';

  switch (normalizedTypes[0]) {
    case 'BADGE':
      return 'twitch-badge';
    case 'EMOTE':
      return 'twitch-emote';
    case 'DIRECT_ENTITLEMENT':
      return 'in-game';
    default:
      return 'unknown';
  }
}
