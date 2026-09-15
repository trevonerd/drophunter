import { toSlug } from '../../shared/utils';
import type { TwitchStreamer } from '../../types';
import { logDebug, logWarn } from '../logging';
import { TwitchInvalidResponseError } from './errors.ts';
import { normalizeImageUrl, normalizeText, toNumber } from './parsing';

const DROPS_TAG_ID = 'c2542d6d-cd10-4532-919b-3d19f30a768b';
const DIRECTORY_GAME_QUERY_HASH = '76cb069d835b8a02914c08dc42c421d0dafda8af5b113a3f19141824b901402f';

type DirectoryEdge = { readonly node?: Record<string, unknown> };
export type DirectoryStreamersResult = TwitchStreamer[] & { languageFilterApplied: boolean };

export interface DirectoryPayloadRequest {
  readonly game: string;
  readonly slug: string;
  readonly tags?: readonly string[];
  readonly broadcasterLanguages?: readonly string[];
}

export interface DirectoryStreamersRequest {
  readonly gameName: string;
  readonly categorySlug: string;
  readonly language?: string;
}

export interface DirectoryTransport {
  post<T>(payload: Record<string, unknown>): Promise<T>;
}

export function normalizeStreamerLanguage(value: unknown): string | undefined {
  const normalized = normalizeText(value).toLowerCase().replace(/_/g, '-');
  if (!normalized) return undefined;
  const [primary] = normalized.split('-');
  return /^[a-z]{2,3}$/.test(primary) ? primary : undefined;
}

export function normalizeLanguageForApi(storedLanguage: string): string {
  return storedLanguage.toUpperCase();
}

export function extractBroadcasterLanguage(node: Record<string, unknown>): string | undefined {
  const broadcaster =
    node.broadcaster && typeof node.broadcaster === 'object'
      ? (node.broadcaster as Record<string, unknown>)
      : null;
  const settings =
    broadcaster?.broadcastSettings && typeof broadcaster.broadcastSettings === 'object'
      ? (broadcaster.broadcastSettings as Record<string, unknown>)
      : null;
  return normalizeStreamerLanguage(
    settings?.language ??
      settings?.broadcastLanguage ??
      broadcaster?.broadcastLanguage ??
      broadcaster?.primaryBroadcastLanguage ??
      broadcaster?.language ??
      node.broadcasterLanguage ??
      node.broadcastLanguage ??
      node.language ??
      node.lang,
  );
}

export function buildDirectoryPayload(request: DirectoryPayloadRequest): Record<string, unknown> {
  return {
    operationName: 'DirectoryPage_Game',
    variables: {
      game: request.game.toLowerCase(),
      slug: request.slug,
      options: {
        includeRestricted: ['SUB_ONLY_LIVE'],
        sort: 'VIEWER_COUNT',
        recommendationsContext: { platform: 'web' },
        requestID: 'JIRA-VXP-2397',
        ...(request.tags ? { tags: request.tags } : {}),
        ...(request.broadcasterLanguages?.length
          ? { broadcasterLanguages: request.broadcasterLanguages }
          : {}),
      },
      sortTypeIsRecency: false,
      includeCostreaming: true,
      limit: 30,
    },
    extensions: { persistedQuery: { version: 1, sha256Hash: DIRECTORY_GAME_QUERY_HASH } },
  };
}

function parseViewerCount(node: Record<string, unknown>): number {
  return Math.max(
    0,
    Math.round(toNumber(node.viewersCount ?? node.viewerCount ?? node.viewers) ?? Number.MAX_SAFE_INTEGER),
  );
}

function extractBroadcaster(
  node: Record<string, unknown>,
): { readonly login: string; readonly displayName: string } | null {
  const broadcaster = node.broadcaster;
  if (!broadcaster || typeof broadcaster !== 'object') return null;
  const payload = broadcaster as Record<string, unknown>;
  const login = normalizeText(payload.login).toLowerCase();
  return login ? { login, displayName: normalizeText(payload.displayName) || login } : null;
}

export function parseDirectoryEdges(edges: readonly DirectoryEdge[]): TwitchStreamer[] {
  const byChannel = new Map<string, TwitchStreamer>();
  edges.forEach((edge) => {
    const node = edge.node;
    if (!node || typeof node !== 'object') return;
    const broadcaster = extractBroadcaster(node);
    if (!broadcaster) return;
    const candidate: TwitchStreamer = {
      id: broadcaster.login,
      name: broadcaster.login,
      displayName: broadcaster.displayName,
      isLive: true,
      viewerCount: parseViewerCount(node),
      broadcasterLanguage: extractBroadcasterLanguage(node),
      thumbnailUrl: normalizeImageUrl(node.previewImageURL),
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

function withLanguageFilterApplied(
  streamers: TwitchStreamer[],
  languageFilterApplied: boolean,
): DirectoryStreamersResult {
  return Object.assign(streamers, { languageFilterApplied });
}

async function fetchDirectoryEdges(
  transport: DirectoryTransport,
  request: DirectoryPayloadRequest,
): Promise<DirectoryEdge[]> {
  const data = await transport.post<{ game?: { streams?: { edges?: DirectoryEdge[] } } }>(
    buildDirectoryPayload(request),
  );
  const edges = data?.game?.streams?.edges;
  if (!Array.isArray(edges)) {
    throw new TwitchInvalidResponseError('Twitch directory response is missing stream edges');
  }
  if (edges.some((edge) => !edge || typeof edge !== 'object')) {
    throw new TwitchInvalidResponseError('Twitch directory response contains invalid stream edges');
  }
  if (edges.length > 0 && parseDirectoryEdges(edges).length === 0) {
    throw new TwitchInvalidResponseError('Twitch directory response contains no readable stream edges');
  }
  return edges;
}

export async function fetchDirectoryStreamers(
  transport: DirectoryTransport,
  request: DirectoryStreamersRequest,
): Promise<DirectoryStreamersResult> {
  const slug = normalizeText(request.categorySlug) || toSlug(request.gameName);
  const game = normalizeText(request.gameName) || slug;
  if (request.language) {
    const filtered = parseDirectoryEdges(
      await fetchDirectoryEdges(transport, {
        game,
        slug,
        tags: [DROPS_TAG_ID],
        broadcasterLanguages: [normalizeLanguageForApi(request.language)],
      }),
    );
    if (filtered.length > 0) return withLanguageFilterApplied(filtered, true);
    logDebug('Language filter returned 0 results, falling back to unfiltered', {
      language: request.language,
    });
  }
  const streamers = parseDirectoryEdges(
    await fetchDirectoryEdges(transport, { game, slug, tags: [DROPS_TAG_ID] }),
  );
  if (streamers.length === 0)
    logWarn(`[TwitchApiClient] No drops-tagged streams found for "${game}" (slug: ${slug})`);
  return withLanguageFilterApplied(streamers, false);
}
