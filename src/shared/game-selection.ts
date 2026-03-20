import { TwitchDrop, TwitchGame } from '../types/index.ts';
import { normalizeToken, tokenOverlapScore } from './matching.ts';
import { toSlug } from './utils.ts';

function normalizedGameName(game: TwitchGame): string {
  return normalizeToken(game.name);
}

function normalizedGameCategory(game: TwitchGame): string {
  return normalizeToken(game.categorySlug ?? toSlug(game.name));
}

function parseEndsAt(endsAt?: string | null): number {
  if (!endsAt) {
    return Number.POSITIVE_INFINITY;
  }
  const parsed = new Date(endsAt).getTime();
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function normalizedCampaignTitle(game: TwitchGame): string {
  const campaignName = typeof game.campaignName === 'string' ? game.campaignName.trim() : '';
  if (!campaignName) {
    return '';
  }
  return normalizeToken(campaignName) === normalizeToken(game.name) ? '' : campaignName;
}

function fallbackDisplayName(game: TwitchGame): string {
  return game.displayName?.trim() || game.name;
}

export function gameKey(game: TwitchGame): string {
  if (game.campaignId) {
    return `campaign:${game.campaignId}`;
  }
  if (game.id) {
    return `id:${game.id}`;
  }
  return `name:${normalizedGameName(game)}::${game.endsAt ?? ''}`;
}

export function getGameDisplayLabel(game: TwitchGame): string {
  return fallbackDisplayName(game);
}

export function compareGamesForDisplayOrder(left: TwitchGame, right: TwitchGame): number {
  const leftEndsAt = parseEndsAt(left.endsAt);
  const rightEndsAt = parseEndsAt(right.endsAt);
  if (leftEndsAt !== rightEndsAt) {
    return leftEndsAt - rightEndsAt;
  }
  const byCampaign = (left.campaignId ?? '').localeCompare(right.campaignId ?? '');
  if (byCampaign !== 0) {
    return byCampaign;
  }
  const byId = (left.id ?? '').localeCompare(right.id ?? '');
  if (byId !== 0) {
    return byId;
  }
  return left.name.localeCompare(right.name);
}

export function applyGameDisplayNames(games: TwitchGame[]): TwitchGame[] {
  const groups = new Map<string, TwitchGame[]>();
  games.forEach((game) => {
    const key = normalizedGameName(game) || game.id;
    const current = groups.get(key) ?? [];
    current.push(game);
    groups.set(key, current);
  });

  const labels = new Map<string, string>();
  groups.forEach((group) => {
    if (group.length === 1) {
      const [game] = group;
      labels.set(gameKey(game), game.name);
      return;
    }

    const ordered = group.slice().sort(compareGamesForDisplayOrder);
    ordered.forEach((game, index) => {
      const subtitle = normalizedCampaignTitle(game) || `Campaign ${index + 1}`;
      labels.set(gameKey(game), `${game.name} · ${subtitle}`);
    });
  });

  return games.map((game) => ({
    ...game,
    displayName: labels.get(gameKey(game)) ?? game.name,
  }));
}

export function dedupeGamesByIdentity(games: TwitchGame[]): TwitchGame[] {
  const merged = new Map<string, TwitchGame>();

  games.forEach((game) => {
    const key = gameKey(game);
    const previous = merged.get(key);
    merged.set(key, {
      ...(previous ?? {
        id: game.id || key.replace(/[^a-z0-9-]+/gi, '-'),
        name: game.name,
        displayName: game.displayName || game.name,
        campaignName: game.campaignName,
        imageUrl: '',
        endsAt: null,
        expiresInMs: null,
        expiryStatus: 'unknown',
        dropCount: 0,
      }),
      ...game,
      displayName: game.displayName || previous?.displayName || game.name,
      campaignName: game.campaignName || previous?.campaignName,
      categorySlug: game.categorySlug || previous?.categorySlug || undefined,
      imageUrl: game.imageUrl || previous?.imageUrl || '',
      endsAt: game.endsAt ?? previous?.endsAt ?? null,
      expiresInMs: game.expiresInMs ?? previous?.expiresInMs ?? null,
      expiryStatus: game.expiryStatus ?? previous?.expiryStatus ?? 'unknown',
      dropCount: game.dropCount ?? previous?.dropCount ?? 0,
      allowedChannels: game.allowedChannels ?? previous?.allowedChannels ?? null,
    });
  });

  return Array.from(merged.values());
}

export function isSameGame(left: TwitchGame, right: TwitchGame): boolean {
  return (
    left.id === right.id ||
    Boolean(left.campaignId && right.campaignId && left.campaignId === right.campaignId) ||
    gameKey(left) === gameKey(right)
  );
}

export function findMatchingGame(target: TwitchGame, source: TwitchGame[]): TwitchGame | null {
  const targetKey = gameKey(target);
  const exact = source.find(
    (game) =>
      game.id === target.id ||
      Boolean(game.campaignId && target.campaignId && game.campaignId === target.campaignId) ||
      gameKey(game) === targetKey,
  );
  if (exact) {
    return exact;
  }

  if (target.campaignId) {
    return null;
  }

  const targetName = normalizedGameName(target);
  const targetCategory = normalizedGameCategory(target);
  let bestMatch: TwitchGame | null = null;
  let bestScore = 0;

  source.forEach((candidate) => {
    if (candidate.campaignId) {
      return;
    }

    const candidateName = normalizedGameName(candidate);
    const candidateCategory = normalizedGameCategory(candidate);
    let score = 0;
    if (targetName.length > 0 && candidateName.length > 0 && targetName === candidateName) {
      score += 100;
    }
    if (
      targetName.length > 0 &&
      candidateName.length > 0 &&
      (candidateName.includes(targetName) || targetName.includes(candidateName))
    ) {
      score += 40;
    }
    score += Math.round(tokenOverlapScore(targetName, candidateName) * 40);
    if (targetCategory && candidateCategory && targetCategory === candidateCategory) {
      score += 35;
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = candidate;
    }
  });

  return bestScore >= 35 ? bestMatch : null;
}

export function dropMatchesGame(drop: TwitchDrop, selected: TwitchGame): boolean {
  if (selected.campaignId) {
    return Boolean(drop.campaignId && drop.campaignId === selected.campaignId);
  }

  const selectedName = normalizedGameName(selected);
  const selectedCategory = normalizedGameCategory(selected);
  const byId = drop.gameId === selected.id;
  const dropName = normalizeToken(drop.gameName);
  const byName =
    selectedName.length > 0 &&
    (dropName === selectedName ||
      dropName.includes(selectedName) ||
      selectedName.includes(dropName) ||
      tokenOverlapScore(dropName, selectedName) > 0.5);
  const dropCategory = normalizeToken(drop.categorySlug ?? toSlug(drop.gameName));
  const byCategory =
    selectedCategory.length > 0 && dropCategory.length > 0 && selectedCategory === dropCategory;

  return byId || byName || byCategory;
}
