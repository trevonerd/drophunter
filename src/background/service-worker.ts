import { AppState, DropStatus, DropsSnapshot, Message, TwitchDrop, TwitchGame, TwitchStreamer } from '../types';
import { TwitchApiClient } from './twitch-api/client';
import { fetchTwitchIntegrityToken } from './twitch-api/gql';
import { isLikelyAuthError, sanitizeTwitchSession, TwitchSession } from './twitch-api/types';

const DROPS_TAG_ID = 'c2542d6d-cd10-4532-919b-3d19f30a768b';
const PROGRESS_POLL_MS = 15_000;
const INVALID_STREAM_THRESHOLD = 8;
const STREAM_ROTATE_COOLDOWN_MS = 5 * 60_000;
const STREAM_VALIDATION_GRACE_MS = 75_000;
const INVENTORY_REFRESH_INTERVAL_MS = 90_000;
const GAMES_CACHE_TTL_MS = 45 * 60_000;
const TWITCH_SESSION_RETRY_COOLDOWN_MS = 5_000;
const DROP_CLAIM_RETRY_COOLDOWN_MS = 45_000;
const TWITCH_SESSION_STORAGE_KEY = 'twitchSession';
const DROPS_SNAPSHOT_CACHE_KEY = 'dropsSnapshotCache';
const LOG_PREFIX = '[DropHunter]';
const ENABLE_CONTENT_FALLBACK = false;

interface StreamContext {
  channelName: string;
  categorySlug: string;
  categoryLabel: string;
  streamTitle: string;
  titleContainsDrops: boolean;
  hasDropsSignal: boolean;
  isLive: boolean;
  pageUrl: string;
}

function logInfo(...args: unknown[]) {
  console.info(LOG_PREFIX, ...args);
}

function logWarn(...args: unknown[]) {
  console.warn(LOG_PREFIX, ...args);
}

function sessionDebugSummary(session: TwitchSession | null) {
  if (!session) {
    return { available: false };
  }
  return {
    available: true,
    userId: session.userId || null,
    oauthTokenLength: session.oauthToken ? session.oauthToken.length : 0,
    hasIntegrity: Boolean(session.clientIntegrity),
    deviceIdSuffix: session.deviceId ? session.deviceId.slice(-6) : null,
    uuid: session.uuid || null,
    clientId: session.clientId || null,
  };
}

const createInitialState = (): AppState => ({
  selectedGame: null,
  isRunning: false,
  isPaused: false,
  activeStreamer: null,
  currentDrop: null,
  completedDrops: [],
  pendingDrops: [],
  allDrops: [],
  availableGames: [],
  queue: [],
  workspaceWindowId: null,
  monitorWindowId: null,
  tabId: null,
  directoryTabId: null,
  dropsTabId: null,
  inventoryTabId: null,
  completionNotified: false,
});

function sameCampaignId(left?: string | null, right?: string | null): boolean {
  return Boolean(left && right && left === right);
}

let appState: AppState = createInitialState();
let monitoringInterval: number | null = null;
let monitorTickInFlight = false;
let invalidStreamChecks = 0;
let lastStreamRotationAt = 0;
let streamValidationGraceUntil = 0;
let lastInventoryRefreshAt = 0;
let gamesCacheLastFetchedAt = 0;
let gamesCacheRefreshInFlight: Promise<TwitchGame[]> | null = null;
let twitchSessionCache: TwitchSession | null = null;
let twitchSessionFetchInFlight: Promise<TwitchSession | null> | null = null;
let twitchSessionLastAttemptAt = 0;
let cachedDropsSnapshot: TwitchDrop[] = [];
let dropClaimInFlight = false;
const dropClaimRetryAtById = new Map<string, number>();

chrome.runtime.onStartup.addListener(async () => {
  await loadState();
});

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'update') {
    appState = createInitialState();
    gamesCacheLastFetchedAt = 0;
    await chrome.storage.local.set({ appState, gamesCacheLastFetchedAt });
    broadcastStateUpdate();
    return;
  }
  await loadState();
});

function normalizeGameSelection(games: TwitchGame[]) {
  if (!appState.selectedGame) {
    return;
  }
  const selected = findMatchingGame(appState.selectedGame, games);
  if (selected) {
    appState.selectedGame = selected;
  }
}

function normalizeQueueSelection(games: TwitchGame[]) {
  if (!Array.isArray(appState.queue) || appState.queue.length === 0) {
    appState.queue = [];
    return;
  }

  const isExpiredGame = (game: TwitchGame): boolean => {
    if (typeof game.expiresInMs === 'number' && Number.isFinite(game.expiresInMs)) {
      return game.expiresInMs <= 0;
    }
    if (game.endsAt) {
      const endsAtMs = new Date(game.endsAt).getTime();
      if (Number.isFinite(endsAtMs)) {
        return endsAtMs <= Date.now();
      }
    }
    return false;
  };

  const normalized: TwitchGame[] = [];
  const seen = new Set<string>();
  appState.queue.forEach((queuedGame) => {
    const resolved = findMatchingGame(queuedGame, games) ?? queuedGame;
    if (isExpiredGame(resolved)) {
      return;
    }
    const key = gameKey(resolved);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    normalized.push(resolved);
  });

  appState.queue = normalized;
}

function gameKey(game: TwitchGame): string {
  if (game.campaignId) {
    return `campaign:${game.campaignId}`;
  }
  if (game.id) {
    return `id:${game.id}`;
  }
  return `name:${normalizeToken(game.name)}::${game.endsAt ?? ''}`;
}

function gameSpecificityScore(game: TwitchGame): number {
  let score = 0;
  if (game.campaignId) {
    score += 100;
  }
  if (typeof game.id === 'string' && game.id.startsWith('campaign-')) {
    score += 20;
  }
  if (typeof game.dropCount === 'number' && Number.isFinite(game.dropCount)) {
    score += Math.max(0, game.dropCount);
  }
  if (typeof game.imageUrl === 'string' && game.imageUrl.length > 0) {
    score += 5;
  }
  if (typeof game.expiresInMs === 'number' && Number.isFinite(game.expiresInMs) && game.expiresInMs > 0) {
    score += 3;
  }
  return score;
}

function choosePreferredGame(candidates: TwitchGame[]): TwitchGame | null {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }
  return candidates
    .slice()
    .sort((left, right) => {
      const byScore = gameSpecificityScore(right) - gameSpecificityScore(left);
      if (byScore !== 0) {
        return byScore;
      }
      return left.name.localeCompare(right.name);
    })[0];
}

function dedupeAvailableGames(games: TwitchGame[]): TwitchGame[] {
  const byName = new Map<string, TwitchGame[]>();
  games.forEach((game) => {
    const nameKey = normalizeToken(game.name) || game.id;
    const current = byName.get(nameKey) ?? [];
    current.push(game);
    byName.set(nameKey, current);
  });

  const deduped: TwitchGame[] = [];
  byName.forEach((group) => {
    const withCampaign = group.filter((game) => Boolean(game.campaignId));
    if (withCampaign.length > 0) {
      const byCampaign = new Map<string, TwitchGame[]>();
      withCampaign.forEach((game) => {
        const key = game.campaignId as string;
        const current = byCampaign.get(key) ?? [];
        current.push(game);
        byCampaign.set(key, current);
      });
      byCampaign.forEach((campaignGroup) => {
        const preferred = choosePreferredGame(campaignGroup);
        if (preferred) {
          deduped.push(preferred);
        }
      });
      return;
    }

    const preferred = choosePreferredGame(group);
    if (preferred) {
      deduped.push(preferred);
    }
  });

  return deduped.sort((a, b) => a.name.localeCompare(b.name));
}

function tokenOverlapScore(left: string, right: string): number {
  const leftTokens = new Set(normalizeToken(left).split(' ').filter((token) => token.length >= 2));
  const rightTokens = new Set(normalizeToken(right).split(' ').filter((token) => token.length >= 2));
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }
  let overlap = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  });
  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function findMatchingGame(target: TwitchGame, source: TwitchGame[]): TwitchGame | null {
  const targetKey = gameKey(target);
  const exact = source.find((game) => game.id === target.id || sameCampaignId(game.campaignId, target.campaignId) || gameKey(game) === targetKey);
  if (exact) {
    return exact;
  }

  const targetName = normalizeToken(target.name);
  const targetCategory = normalizeToken(target.categorySlug ?? toSlug(target.name));
  let bestMatch: TwitchGame | null = null;
  let bestScore = 0;

  source.forEach((candidate) => {
    const candidateName = normalizeToken(candidate.name);
    const candidateCategory = normalizeToken(candidate.categorySlug ?? toSlug(candidate.name));
    let score = 0;
    if (targetName && candidateName && targetName === candidateName) {
      score += 100;
    }
    if (targetName && candidateName && (candidateName.includes(targetName) || targetName.includes(candidateName))) {
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

function mergeAvailableGames(existing: TwitchGame[], incoming: TwitchGame[]): TwitchGame[] {
  const isExpiredGame = (game: TwitchGame): boolean => {
    if (typeof game.expiresInMs === 'number' && Number.isFinite(game.expiresInMs)) {
      return game.expiresInMs <= 0;
    }
    if (game.endsAt) {
      const endsAtMs = new Date(game.endsAt).getTime();
      if (Number.isFinite(endsAtMs)) {
        return endsAtMs <= Date.now();
      }
    }
    return false;
  };

  const merged = new Map<string, TwitchGame>();
  const upsert = (game: TwitchGame) => {
    if (isExpiredGame(game)) {
      return;
    }
    const key = gameKey(game);
    const previous = merged.get(key);
    merged.set(key, {
      ...(previous ?? {
        id: game.id || key.replace(/[^a-z0-9-]+/gi, '-'),
        name: game.name,
        imageUrl: '',
        endsAt: null,
        expiresInMs: null,
        expiryStatus: 'unknown',
        dropCount: 0,
      }),
      ...game,
      imageUrl: game.imageUrl || previous?.imageUrl || '',
      endsAt: game.endsAt ?? previous?.endsAt ?? null,
      expiresInMs: game.expiresInMs ?? previous?.expiresInMs ?? null,
      expiryStatus: game.expiryStatus ?? previous?.expiryStatus ?? 'unknown',
      dropCount: game.dropCount ?? previous?.dropCount ?? 0,
    });
  };

  existing.forEach(upsert);
  incoming.forEach(upsert);
  const filtered = Array.from(merged.values()).filter((game) => !isExpiredGame(game));
  const deduped = dedupeAvailableGames(filtered);
  if (filtered.length !== deduped.length) {
    logInfo('Collapsed duplicate games after merge', {
      before: filtered.length,
      after: deduped.length,
    });
  }
  return deduped;
}

function dropRemainingMinutes(drop: TwitchDrop): number {
  if (typeof drop.remainingMinutes === 'number' && Number.isFinite(drop.remainingMinutes)) {
    return Math.max(0, drop.remainingMinutes);
  }
  return Number.POSITIVE_INFINITY;
}

function compareDropPriority(a: TwitchDrop, b: TwitchDrop): number {
  const byRemaining = dropRemainingMinutes(a) - dropRemainingMinutes(b);
  if (byRemaining !== 0) {
    return byRemaining;
  }
  if (a.progress !== b.progress) {
    return b.progress - a.progress;
  }
  return a.name.localeCompare(b.name);
}

function dropStateKey(drop: TwitchDrop): string {
  return `${drop.campaignId ?? ''}::${normalizeToken(drop.gameName)}::${normalizeToken(drop.name)}::${normalizeToken(drop.imageUrl)}`;
}

function dropMatchesSelectedGame(drop: TwitchDrop, selected: TwitchGame): boolean {
  const selectedName = normalizeToken(selected.name);
  const selectedCategory = normalizeToken(selected.categorySlug ?? toSlug(selected.name));
  const byId = drop.gameId === selected.id;
  const byCampaign = sameCampaignId(drop.campaignId, selected.campaignId);
  const dropName = normalizeToken(drop.gameName);
  const byName =
    selectedName.length > 0 &&
    (dropName === selectedName ||
      dropName.includes(selectedName) ||
      selectedName.includes(dropName) ||
      tokenOverlapScore(dropName, selectedName) >= 0.5);
  const dropCategory = normalizeToken(drop.categorySlug ?? toSlug(drop.gameName));
  const byCategory = selectedCategory.length > 0 && dropCategory.length > 0 && selectedCategory === dropCategory;
  return byId || byCampaign || byName || byCategory;
}

function mergeDropProgressMonotonic(nextDrop: TwitchDrop, previousDrop: TwitchDrop): TwitchDrop {
  const mergedProgress = Math.max(nextDrop.progress, previousDrop.progress);
  const mergedClaimed = nextDrop.claimed || previousDrop.claimed;
  const mergedClaimable = mergedClaimed ? false : Boolean(nextDrop.claimable);
  const mergedRequiredMinutes = nextDrop.requiredMinutes ?? previousDrop.requiredMinutes ?? null;
  const mergedRemainingMinutes =
    mergedClaimed || mergedClaimable
      ? 0
      : nextDrop.remainingMinutes !== undefined && nextDrop.remainingMinutes !== null
        ? previousDrop.remainingMinutes !== undefined && previousDrop.remainingMinutes !== null
          ? Math.min(previousDrop.remainingMinutes, nextDrop.remainingMinutes)
          : nextDrop.remainingMinutes
        : previousDrop.remainingMinutes ?? null;

  return {
    ...nextDrop,
    progress: mergedClaimed || mergedClaimable ? 100 : mergedProgress,
    claimed: mergedClaimed,
    claimable: mergedClaimable,
    imageUrl: nextDrop.imageUrl || previousDrop.imageUrl,
    campaignId: nextDrop.campaignId || previousDrop.campaignId,
    requiredMinutes: mergedRequiredMinutes,
    remainingMinutes: mergedRemainingMinutes,
    progressSource: nextDrop.progressSource ?? previousDrop.progressSource,
    status: mergedClaimed ? 'completed' : mergedClaimable ? 'pending' : mergedProgress > 0 ? 'active' : 'pending',
  };
}

function isDropCompleted(drop: TwitchDrop): boolean {
  return drop.claimed || (drop.progress >= 100 && !drop.claimable);
}

function splitDropsForSelectedGame(allDrops: TwitchDrop[]) {
  const selected = appState.selectedGame;
  if (!selected) {
    appState.allDrops = [];
    appState.pendingDrops = [];
    appState.completedDrops = [];
    appState.currentDrop = null;
    return;
  }

  const strictRelevant = allDrops.filter((drop) => dropMatchesSelectedGame(drop, selected));
  const selectedName = normalizeToken(selected.name);
  const relaxedRelevant =
    strictRelevant.length > 0
      ? strictRelevant
      : allDrops.filter((drop) => {
          const dropName = normalizeToken(drop.gameName);
          return (
            selectedName.length > 0 &&
            (dropName.includes(selectedName) || selectedName.includes(dropName) || tokenOverlapScore(dropName, selectedName) >= 0.45)
          );
        });

  if (strictRelevant.length === 0 && relaxedRelevant.length > 0) {
    logWarn('Relaxed game-drop matching used for selection', {
      selectedGame: selected.name,
      selectedCampaignId: selected.campaignId ?? null,
      matchedDrops: relaxedRelevant.length,
    });
  }

  if (strictRelevant.length === 0 && relaxedRelevant.length === 0 && allDrops.length > 0) {
    const sampleGameNames = Array.from(new Set(allDrops.map((drop) => drop.gameName))).slice(0, 5);
    logWarn('No drops matched selected game', {
      selectedGame: selected.name,
      selectedCampaignId: selected.campaignId ?? null,
      totalDrops: allDrops.length,
      sampleGameNames,
    });
  }

  const relevant = relaxedRelevant;
  const previousRelevant = appState.allDrops.filter((drop) => dropMatchesSelectedGame(drop, selected));
  const previousByKey = new Map(previousRelevant.map((drop) => [dropStateKey(drop), drop]));

  const mergedRelevant = relevant.map((drop) => {
    const previous = previousByKey.get(dropStateKey(drop));
    if (!previous) {
      return drop;
    }
    return mergeDropProgressMonotonic(drop, previous);
  });
  const mergedKeys = new Set(mergedRelevant.map((drop) => dropStateKey(drop)));
  previousRelevant
    .filter((drop) => !mergedKeys.has(dropStateKey(drop)))
    .filter((drop) => drop.claimed)
    .forEach((drop) => mergedRelevant.push(drop));

  const relevantForState = mergedRelevant;

  const completed = relevantForState.filter((drop) => isDropCompleted(drop)).map((drop) => ({ ...drop, status: 'completed' as const }));
  const pending = relevantForState.filter((drop) => !isDropCompleted(drop));
  const normalizedPending = pending.map((drop) => ({
    ...drop,
    status: drop.progress > 0 || Boolean(drop.claimable) ? ('active' as const) : ('pending' as const),
  }));
  const activeCandidates = normalizedPending.filter((drop) => drop.progress > 0 || Boolean(drop.claimable));
  const activeDrop = (activeCandidates.length > 0 ? activeCandidates : normalizedPending).slice().sort(compareDropPriority)[0] ?? null;

  appState.allDrops = relevantForState;
  appState.completedDrops = completed;
  appState.pendingDrops = normalizedPending;
  appState.currentDrop = activeDrop ? { ...activeDrop, status: 'active' } : null;

  logInfo('Selected game rewards updated', {
    selectedGame: selected.name,
    total: relevantForState.length,
    pending: normalizedPending.length,
    completed: completed.length,
    claimable: normalizedPending.filter((drop) => Boolean(drop.claimable)).length,
  });
}

function updateStateFromSnapshot(snapshot: DropsSnapshot) {
  if (Array.isArray(snapshot.drops) && snapshot.drops.length > 0) {
    cachedDropsSnapshot = snapshot.drops;
  }
  const orderedGames = mergeAvailableGames(appState.availableGames, snapshot.games);
  appState.availableGames = orderedGames;
  normalizeGameSelection(orderedGames);
  normalizeQueueSelection(orderedGames);
  splitDropsForSelectedGame(snapshot.drops);
}

async function loadState() {
  try {
    const result = await chrome.storage.local.get([
      'appState',
      'gamesCacheLastFetchedAt',
      TWITCH_SESSION_STORAGE_KEY,
      DROPS_SNAPSHOT_CACHE_KEY,
    ]);
    if (result.appState) {
      appState = { ...createInitialState(), ...result.appState };
      if (!Array.isArray(appState.queue)) {
        appState.queue = [];
      }
    }
    if (!ENABLE_CONTENT_FALLBACK) {
      appState.workspaceWindowId = null;
      appState.directoryTabId = null;
      appState.dropsTabId = null;
      appState.inventoryTabId = null;
    }
    const restoredCacheFetchedAt = Number(result.gamesCacheLastFetchedAt);
    if (Number.isFinite(restoredCacheFetchedAt) && restoredCacheFetchedAt > 0) {
      gamesCacheLastFetchedAt = restoredCacheFetchedAt;
    } else if (appState.availableGames.length > 0) {
      gamesCacheLastFetchedAt = Date.now();
      await chrome.storage.local.set({ gamesCacheLastFetchedAt });
    } else {
      gamesCacheLastFetchedAt = 0;
    }

    twitchSessionCache = sanitizeTwitchSession(result[TWITCH_SESSION_STORAGE_KEY] as unknown);
    logInfo('Initial Twitch session state from storage', sessionDebugSummary(twitchSessionCache));
    cachedDropsSnapshot = Array.isArray(result[DROPS_SNAPSHOT_CACHE_KEY]) ? (result[DROPS_SNAPSHOT_CACHE_KEY] as TwitchDrop[]) : [];
    if (appState.isRunning && !appState.isPaused) {
      startMonitoring();
    }
  } catch (error) {
    console.error('Error loading state:', error);
  }
}

function shouldRefreshGamesCache(force = false): boolean {
  if (force) {
    return true;
  }
  const hasGames = appState.availableGames.length > 0;
  if (!hasGames) {
    return true;
  }
  if (gamesCacheLastFetchedAt <= 0) {
    return false;
  }
  return Date.now() - gamesCacheLastFetchedAt >= GAMES_CACHE_TTL_MS;
}

async function ensureStateHydratedForCache() {
  const hasRuntimeState =
    appState.availableGames.length > 0 || appState.queue.length > 0 || Boolean(appState.selectedGame) || appState.isRunning || gamesCacheLastFetchedAt > 0;
  if (hasRuntimeState) {
    return;
  }
  await loadState();
}

async function saveState() {
  await chrome.storage.local.set({ appState, [DROPS_SNAPSHOT_CACHE_KEY]: cachedDropsSnapshot });
  broadcastStateUpdate();
}

function broadcastStateUpdate() {
  chrome.runtime.sendMessage({
    type: 'UPDATE_STATE',
    payload: appState,
  }).catch(() => undefined);
}

function directoryUrl(gameName: string): string {
  const slug = encodeURIComponent(gameName);
  return `https://www.twitch.tv/directory/category/${slug}?tl=${DROPS_TAG_ID}`;
}

function inventoryUrl(): string {
  return 'https://www.twitch.tv/drops/inventory';
}

function streamerWatchUrl(channelName: string): string {
  const channel = encodeURIComponent(channelName.toLowerCase());
  return `https://www.twitch.tv/${channel}`;
}

function clearWorkspaceReferences() {
  appState.workspaceWindowId = null;
  appState.tabId = null;
  appState.activeStreamer = null;
  appState.directoryTabId = null;
  appState.dropsTabId = null;
  appState.inventoryTabId = null;
}

async function getWorkspaceWindowId(): Promise<number | null> {
  if (!appState.workspaceWindowId) {
    return null;
  }
  const existing = await chrome.windows.get(appState.workspaceWindowId).catch(() => null);
  if (existing?.id) {
    return existing.id;
  }
  clearWorkspaceReferences();
  return null;
}

async function notifyWorkspaceWindowCreated() {
  await chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'DropHunter Workspace',
    message: 'Opened a dedicated Twitch window for farming tabs.',
    priority: 1,
  });
}

function monitorDashboardUrl(): string {
  return chrome.runtime.getURL('monitor.html');
}

async function applyBestEffortAlwaysOnTop(windowId: number) {
  await chrome.windows
    .update(windowId, {
      focused: true,
      ...( { alwaysOnTop: true } as any ),
    } as any)
    .catch(() => chrome.windows.update(windowId, { focused: true }).catch(() => undefined));
}

async function openMonitorDashboardWindow() {
  const url = monitorDashboardUrl();
  if (appState.monitorWindowId) {
    const existingWindow = await chrome.windows.get(appState.monitorWindowId, { populate: true }).catch(() => null);
    if (existingWindow?.id) {
      const monitorTab = existingWindow.tabs?.find((tab) => (tab.url ?? '').startsWith(url));
      if (monitorTab?.id) {
        await chrome.tabs.update(monitorTab.id, { active: true }).catch(() => undefined);
      } else {
        await chrome.tabs.create({
          windowId: existingWindow.id,
          url,
          active: true,
        }).catch(() => undefined);
      }
      await applyBestEffortAlwaysOnTop(existingWindow.id);
      await saveState();
      return { success: true };
    }
    appState.monitorWindowId = null;
  }

  const createdWindow = await chrome.windows
    .create({
      url,
      type: 'popup',
      width: 360,
      height: 300,
      focused: true,
    })
    .catch(() => null);
  if (!createdWindow?.id) {
    return { success: false, error: 'Unable to open monitor window.' };
  }

  appState.monitorWindowId = createdWindow.id;
  await applyBestEffortAlwaysOnTop(createdWindow.id);
  await saveState();
  return { success: true };
}

async function createManagedTab(url: string, active = false): Promise<chrome.tabs.Tab | null> {
  const workspaceWindowId = ENABLE_CONTENT_FALLBACK ? await getWorkspaceWindowId() : null;
  if (workspaceWindowId) {
    return chrome.tabs.create({
      windowId: workspaceWindowId,
      url,
      active,
    }).catch(() => null);
  }

  if (active) {
    const currentActiveTab = (await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []))[0] ?? null;
    if (currentActiveTab?.id) {
      const currentUrl = currentActiveTab.url ?? '';
      const canReuseCurrent =
        !currentUrl.startsWith('chrome://') &&
        !currentUrl.startsWith('chrome-extension://') &&
        !currentUrl.startsWith('edge://');
      if (canReuseCurrent) {
        const updated = await chrome.tabs.update(currentActiveTab.id, { url, active: true }).catch(() => null);
        if (updated?.id) {
          return updated;
        }
      }
    }
  }

  const focusedWindow = await chrome.windows.getLastFocused().catch(() => null);
  if (focusedWindow?.id) {
    return chrome.tabs.create({ windowId: focusedWindow.id, url, active }).catch(() => null);
  }

  return chrome.tabs.create({ url, active }).catch(() => null);
}

async function ensureManagedTab(existingTabId: number | null, targetUrl: string, active = false): Promise<number | null> {
  if (existingTabId) {
    const existingTab = await chrome.tabs.get(existingTabId).catch(() => null);
    if (existingTab?.id) {
      if (existingTab.url !== targetUrl) {
        await chrome.tabs.update(existingTab.id, { url: targetUrl, active }).catch(() => undefined);
      } else if (active && !existingTab.active) {
        await chrome.tabs.update(existingTab.id, { active: true }).catch(() => undefined);
      }
      return existingTab.id;
    }
  }

  const created = await createManagedTab(targetUrl, active);
  return created?.id ?? null;
}

async function closeUtilityTabsOutsideWorkspace() {
  const workspaceWindowId = await getWorkspaceWindowId();
  if (!workspaceWindowId) {
    return;
  }

  const utilityTabs = await chrome.tabs.query({
    url: [
      'https://www.twitch.tv/drops/campaigns*',
      'https://twitch.tv/drops/campaigns*',
      'https://www.twitch.tv/drops/inventory*',
      'https://twitch.tv/drops/inventory*',
      'https://www.twitch.tv/directory/category/*',
      'https://twitch.tv/directory/category/*',
    ],
  });

  const toClose = utilityTabs
    .filter((tab) => tab.id && tab.windowId !== workspaceWindowId)
    .map((tab) => tab.id as number);
  if (toClose.length > 0) {
    await chrome.tabs.remove(toClose).catch(() => undefined);
  }
}

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function scoreCategoryMatch(gameName: string, slug: string, label: string): number {
  const gameSlug = toSlug(gameName);
  const slugNorm = toSlug(slug);
  const labelSlug = toSlug(label);
  let score = 0;
  if (slugNorm === gameSlug || labelSlug === gameSlug) {
    score += 100;
  }
  if (slugNorm.includes(gameSlug) || gameSlug.includes(slugNorm)) {
    score += 40;
  }
  const gameTokens = new Set(gameSlug.split('-').filter(Boolean));
  const labelTokens = new Set(labelSlug.split('-').filter(Boolean));
  gameTokens.forEach((token) => {
    if (labelTokens.has(token) || slugNorm.includes(token)) {
      score += 8;
    }
  });
  if (/\d/.test(slugNorm) && /\d/.test(gameSlug) && slugNorm.replace(/\D/g, '') === gameSlug.replace(/\D/g, '')) {
    score += 12;
  }
  return score;
}

function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function scoreDropMatch(base: TwitchDrop, candidate: TwitchDrop): number {
  const baseName = normalizeToken(base.name);
  const candidateName = normalizeToken(candidate.name);
  const baseGame = normalizeToken(base.gameName);
  const candidateGame = normalizeToken(candidate.gameName);
  let score = 0;
  if (baseName === candidateName) {
    score += 100;
  }
  if (candidateName.includes(baseName) || baseName.includes(candidateName)) {
    score += 30;
  }
  if (baseGame && candidateGame && (baseGame.includes(candidateGame) || candidateGame.includes(baseGame))) {
    score += 20;
  }
  if (base.imageUrl && candidate.imageUrl && base.imageUrl === candidate.imageUrl) {
    score += 80;
  }
  return score;
}

async function ensureDropsTab() {
  const created = await createManagedTab('https://www.twitch.tv/drops/campaigns', false);
  appState.dropsTabId = created?.id ?? null;
  return created?.id ?? null;
}

async function closeDropsTab(tabId: number) {
  await chrome.tabs.remove(tabId).catch(() => undefined);
  if (appState.dropsTabId === tabId) {
    appState.dropsTabId = null;
  }
}

async function ensureContentScriptOnTab(tabId: number) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
  } catch {
    // Ignore: content script may already be injected or tab may not allow injection
  }
}

async function persistTwitchSession(session: TwitchSession | null) {
  if (session) {
    await chrome.storage.local.set({ [TWITCH_SESSION_STORAGE_KEY]: session });
    return;
  }
  await chrome.storage.local.remove(TWITCH_SESSION_STORAGE_KEY).catch(() => undefined);
}

function clearTwitchSessionCache() {
  twitchSessionCache = null;
  void persistTwitchSession(null);
}

function trySanitizeSessionCandidate(candidate: unknown): TwitchSession | null {
  return sanitizeTwitchSession(candidate);
}

function findSessionCandidateDeep(value: unknown, depth = 0): TwitchSession | null {
  if (depth > 4 || value == null) {
    return null;
  }

  const direct = trySanitizeSessionCandidate(value);
  if (direct) {
    return direct;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) {
      return null;
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return findSessionCandidateDeep(parsed, depth + 1);
    } catch {
      return null;
    }
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const session = findSessionCandidateDeep(item, depth + 1);
      if (session) {
        return session;
      }
    }
    return null;
  }

  if (typeof value === 'object') {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      const session = findSessionCandidateDeep(nested, depth + 1);
      if (session) {
        return session;
      }
    }
  }

  return null;
}

async function getTwitchCookieValue(name: string): Promise<string> {
  const attempts = ['https://www.twitch.tv', 'https://twitch.tv', 'https://player.twitch.tv'];
  for (const url of attempts) {
    const cookie = await chrome.cookies.get({ url, name }).catch(() => null);
    const value = typeof cookie?.value === 'string' ? cookie.value.trim() : '';
    if (value) {
      return value;
    }
  }
  return '';
}

async function recoverTwitchSessionFromCookies(): Promise<TwitchSession | null> {
  const [authToken, secureAuthToken, uniqueId, secureUniqueId, deviceIdCookie] = await Promise.all([
    getTwitchCookieValue('auth-token'),
    getTwitchCookieValue('__Secure-auth-token'),
    getTwitchCookieValue('unique_id'),
    getTwitchCookieValue('__Secure-unique_id'),
    getTwitchCookieValue('device_id'),
  ]);

  const candidate = trySanitizeSessionCandidate({
    oauthToken: authToken || secureAuthToken,
    deviceId: uniqueId || secureUniqueId || deviceIdCookie,
    uuid: crypto.randomUUID().replace(/-/g, '').slice(0, 16),
  });

  if (!candidate) {
    return null;
  }

  logInfo('Recovered Twitch session from cookies', sessionDebugSummary(candidate));
  return candidate;
}

async function recoverTwitchSessionFromStorageKeys(): Promise<TwitchSession | null> {
  const [localAll, syncAll] = await Promise.all([
    chrome.storage.local.get(null).catch(() => ({} as Record<string, unknown>)),
    chrome.storage.sync.get(null).catch(() => ({} as Record<string, unknown>)),
  ]);

  const local = localAll as Record<string, unknown>;
  const sync = syncAll as Record<string, unknown>;

  const directCandidate = trySanitizeSessionCandidate({
    oauthToken:
      local.oauthToken ??
      sync.oauthToken ??
      local.authToken ??
      sync.authToken ??
      local.accessToken ??
      sync.accessToken ??
      local.token ??
      sync.token,
    userId: local.userId ?? sync.userId ?? local.userID ?? sync.userID,
    deviceId:
      local.deviceId ??
      sync.deviceId ??
      local.local_copy_unique_id ??
      sync.local_copy_unique_id ??
      local.device_id ??
      sync.device_id,
    uuid: local.uuid ?? sync.uuid ?? local.clientSessionId ?? sync.clientSessionId ?? local['client-session-id'] ?? sync['client-session-id'],
    clientIntegrity: local.clientIntegrity ?? sync.clientIntegrity ?? local['client-integrity'] ?? sync['client-integrity'],
    clientId: local.clientId ?? sync.clientId,
  });
  if (directCandidate) {
    logInfo('Recovered Twitch session from flat storage keys', sessionDebugSummary(directCandidate));
    return directCandidate;
  }

  const allEntries = [...Object.entries(local), ...Object.entries(sync)];
  for (const [key, value] of allEntries) {
    const session = findSessionCandidateDeep(value);
    if (session) {
      logInfo('Recovered Twitch session from storage entry', {
        key,
        ...sessionDebugSummary(session),
      });
      return session;
    }
  }

  logWarn('No Twitch session recovered from storage keys');
  return null;
}

async function refreshTwitchIntegrityToken(session: TwitchSession): Promise<TwitchSession | null> {
  try {
    logInfo('Refreshing Twitch Client-Integrity token', {
      deviceIdSuffix: session.deviceId ? session.deviceId.slice(-6) : null,
      oauthTokenLength: session.oauthToken ? session.oauthToken.length : 0,
      hasPreviousIntegrity: Boolean(session.clientIntegrity),
    });
    const token = await fetchTwitchIntegrityToken(session);
    if (!token) {
      return null;
    }
    const updatedSession: TwitchSession = {
      ...session,
      clientIntegrity: token,
    };
    twitchSessionCache = updatedSession;
    await persistTwitchSession(updatedSession);
    logInfo('Twitch Client-Integrity token refreshed', {
      integrityLength: token.length,
      deviceIdSuffix: updatedSession.deviceId ? updatedSession.deviceId.slice(-6) : null,
    });
    return updatedSession;
  } catch (error) {
    logWarn('Unable to refresh Twitch Client-Integrity token', String(error));
    return null;
  }
}

async function ensureSessionIntegrity(session: TwitchSession, forceRefresh = false): Promise<TwitchSession> {
  if (!forceRefresh && session.clientIntegrity) {
    return session;
  }
  const refreshed = await refreshTwitchIntegrityToken(session);
  return refreshed ?? session;
}

async function readTwitchSessionViaExecuteScript(tabId: number): Promise<TwitchSession | null> {
  try {
    const execution = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const normalize = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
        const normalizeToken = (value: unknown): string =>
          normalize(value)
            .replace(/^oauth:/i, '')
            .replace(/^oauth\s+/i, '')
            .trim();
        const getCookie = (name: string): string => {
          const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
          return match?.[1] ? decodeURIComponent(match[1]) : '';
        };
        const parseTwilight = (): { oauthToken: string; userId: string } => {
          const keys = ['twilight-user', 'twilight-user-data', 'twilight-user-data-v2', '__twilight-user', 'twilight-session'];
          const stores: Storage[] = [window.localStorage, window.sessionStorage];
          for (const store of stores) {
            for (const key of keys) {
              const raw = store.getItem(key);
              if (!raw) {
                continue;
              }
              try {
                const parsed = JSON.parse(raw) as Record<string, unknown>;
                const parsedUser = parsed.user && typeof parsed.user === 'object' ? (parsed.user as Record<string, unknown>) : null;
                const oauthToken =
                  normalizeToken(parsed.authToken) ||
                  normalizeToken(parsed.token) ||
                  normalizeToken(parsed.accessToken) ||
                  normalizeToken(parsed.oauthToken);
                const userId =
                  normalize(parsed.userID) ||
                  normalize(parsed.userId) ||
                  normalize(parsed.id) ||
                  normalize(parsedUser?.id);
                if (oauthToken || userId) {
                  return { oauthToken, userId };
                }
              } catch {
                // Ignore malformed entries.
              }
            }
          }
          return { oauthToken: '', userId: '' };
        };

        const twilight = parseTwilight();
        const oauthToken =
          twilight.oauthToken || normalizeToken(getCookie('auth-token')) || normalizeToken(getCookie('__Secure-auth-token'));
        const userId = twilight.userId || '';
        const deviceId =
          normalize(window.localStorage.getItem('local_copy_unique_id')) ||
          normalize(window.localStorage.getItem('device_id')) ||
          normalize(window.localStorage.getItem('deviceId')) ||
          normalize(window.sessionStorage.getItem('local_copy_unique_id')) ||
          normalize(window.sessionStorage.getItem('device_id')) ||
          normalize(window.sessionStorage.getItem('deviceId')) ||
          normalize(getCookie('unique_id')) ||
          normalize(getCookie('__Secure-unique_id')) ||
          normalize(getCookie('device_id'));
        const uuid =
          normalize(window.localStorage.getItem('client-session-id')) ||
          normalize(window.localStorage.getItem('clientSessionId')) ||
          normalize(window.sessionStorage.getItem('client-session-id')) ||
          normalize(window.sessionStorage.getItem('clientSessionId')) ||
          Math.random().toString(16).slice(2, 10);
        const clientIntegrity =
          normalize(window.localStorage.getItem('client-integrity')) || normalize(window.localStorage.getItem('clientIntegrity'));

        if (!oauthToken || !deviceId) {
          return null;
        }

        return {
          oauthToken,
          userId,
          deviceId,
          uuid,
          clientIntegrity: clientIntegrity || undefined,
        };
      },
    });
    const raw = execution[0]?.result;
    const session = sanitizeTwitchSession(raw as unknown);
    if (session) {
      logInfo('Extracted Twitch session via executeScript', { tabId, ...sessionDebugSummary(session) });
      return session;
    }
    logWarn('executeScript session extraction returned empty payload', { tabId });
    return null;
  } catch (error) {
    logWarn('executeScript session extraction failed', { tabId, error: String(error) });
    return null;
  }
}

async function readTwitchSessionFromTab(tabId: number): Promise<TwitchSession | null> {
  const send = async () => chrome.tabs.sendMessage(tabId, { type: 'GET_TWITCH_SESSION' });
  let response: any = null;
  try {
    response = await send();
  } catch (error) {
    logWarn('GET_TWITCH_SESSION send failed on first attempt', { tabId, error: String(error) });
    await ensureContentScriptOnTab(tabId);
    response = await send().catch((secondError) => {
      logWarn('GET_TWITCH_SESSION send failed after injection', { tabId, error: String(secondError) });
      return null;
    });
  }

  if (!response?.success) {
    logWarn('GET_TWITCH_SESSION failed on tab', { tabId });
    return readTwitchSessionViaExecuteScript(tabId);
  }

  const session = sanitizeTwitchSession(response.session as unknown);
  if (!session) {
    logWarn('Received invalid Twitch session payload from tab', { tabId });
    return readTwitchSessionViaExecuteScript(tabId);
  }
  logInfo('Extracted Twitch session from tab', { tabId, ...sessionDebugSummary(session) });
  return session;
}

async function findTwitchSessionInOpenTabs(): Promise<TwitchSession | null> {
  const tabs = await chrome.tabs.query({
    url: ['https://www.twitch.tv/*', 'https://twitch.tv/*', 'https://player.twitch.tv/*'],
  });

  const sortedTabs = tabs
    .slice()
    .sort((left, right) => {
      const leftUrl = left.url ?? '';
      const rightUrl = right.url ?? '';
      const leftIsMain = leftUrl.includes('://www.twitch.tv/') || leftUrl.includes('://twitch.tv/');
      const rightIsMain = rightUrl.includes('://www.twitch.tv/') || rightUrl.includes('://twitch.tv/');
      if (leftIsMain !== rightIsMain) {
        return leftIsMain ? -1 : 1;
      }
      if (Boolean(left.active) !== Boolean(right.active)) {
        return left.active ? -1 : 1;
      }
      return 0;
    });

  for (const tab of sortedTabs) {
    if (!tab.id) {
      continue;
    }
    logInfo('Trying Twitch session extraction from tab', {
      tabId: tab.id,
      url: tab.url ?? null,
      active: Boolean(tab.active),
    });
    const session = await readTwitchSessionFromTab(tab.id).catch(() => null);
    if (session) {
      return session;
    }
  }
  return null;
}

async function fetchTwitchSessionFromHiddenTab(): Promise<TwitchSession | null> {
  let hiddenWindowId: number | null = null;
  let tabId: number | null = null;

  const hiddenWindow = await chrome.windows
    .create({
      url: 'https://www.twitch.tv/drops/inventory',
      focused: false,
      state: 'minimized',
    })
    .catch(() => null);

  if (hiddenWindow?.id) {
    hiddenWindowId = hiddenWindow.id;
    tabId = hiddenWindow.tabs?.find((tab) => Boolean(tab.id))?.id ?? null;
  }

  if (!tabId && hiddenWindowId) {
    const tabs = await chrome.tabs.query({ windowId: hiddenWindowId }).catch(() => []);
    tabId = tabs.find((tab) => Boolean(tab.id))?.id ?? null;
  }

  if (!tabId) {
    if (hiddenWindowId) {
      await chrome.windows.remove(hiddenWindowId).catch(() => undefined);
    }
    return null;
  }

  try {
    await waitForTabComplete(tabId, 15_000);
    await ensureContentScriptOnTab(tabId);
    await new Promise((resolve) => setTimeout(resolve, 900));
    return await readTwitchSessionFromTab(tabId).catch(() => null);
  } finally {
    if (hiddenWindowId) {
      await chrome.windows.remove(hiddenWindowId).catch(() => undefined);
    } else {
      await chrome.tabs.remove(tabId).catch(() => undefined);
    }
  }
}

async function ensureTwitchSession(forceRefresh = false): Promise<TwitchSession | null> {
  if (!forceRefresh && twitchSessionCache) {
    logInfo('Using cached Twitch session', sessionDebugSummary(twitchSessionCache));
    return twitchSessionCache;
  }

  const now = Date.now();
  if (!forceRefresh && now - twitchSessionLastAttemptAt < TWITCH_SESSION_RETRY_COOLDOWN_MS) {
    logWarn('Skipped Twitch session refresh due retry cooldown');
    return null;
  }

  if (twitchSessionFetchInFlight) {
    return twitchSessionFetchInFlight;
  }

  twitchSessionFetchInFlight = (async () => {
    twitchSessionLastAttemptAt = Date.now();
    if (!forceRefresh) {
      const storageResult = (await chrome.storage.local.get([TWITCH_SESSION_STORAGE_KEY]).catch(() => ({}))) as Record<string, unknown>;
      const fromStorageRaw = storageResult[TWITCH_SESSION_STORAGE_KEY];
      const fromStorage = sanitizeTwitchSession(fromStorageRaw as unknown);
      if (fromStorage) {
        twitchSessionCache = fromStorage;
        logInfo('Twitch session restored from storage');
        logInfo('Session details', sessionDebugSummary(fromStorage));
        return fromStorage;
      }

      const recoveredSession = await recoverTwitchSessionFromStorageKeys();
      if (recoveredSession) {
        twitchSessionCache = recoveredSession;
        await persistTwitchSession(recoveredSession);
        twitchSessionLastAttemptAt = Date.now();
        logInfo('Twitch session restored from legacy storage keys');
        logInfo('Session details', sessionDebugSummary(recoveredSession));
        return recoveredSession;
      }
    }

    const fromCookies = await recoverTwitchSessionFromCookies();
    if (fromCookies) {
      twitchSessionCache = fromCookies;
      await persistTwitchSession(fromCookies);
      twitchSessionLastAttemptAt = Date.now();
      logInfo('Twitch session restored from cookies');
      logInfo('Session details', sessionDebugSummary(fromCookies));
      return fromCookies;
    }

    const fromOpenTabs = await findTwitchSessionInOpenTabs();
    if (fromOpenTabs) {
      twitchSessionCache = fromOpenTabs;
      await persistTwitchSession(fromOpenTabs);
      twitchSessionLastAttemptAt = Date.now();
      logInfo('Twitch session extracted from open Twitch tab');
      logInfo('Session details', sessionDebugSummary(fromOpenTabs));
      return fromOpenTabs;
    }

    if (ENABLE_CONTENT_FALLBACK) {
      const fromHidden = await fetchTwitchSessionFromHiddenTab();
      if (fromHidden) {
        twitchSessionCache = fromHidden;
        await persistTwitchSession(fromHidden);
        twitchSessionLastAttemptAt = Date.now();
        logInfo('Twitch session extracted from hidden tab');
        logInfo('Session details', sessionDebugSummary(fromHidden));
        return fromHidden;
      }
    }

    clearTwitchSessionCache();
    logWarn('No Twitch session available for API calls');
    return null;
  })().finally(() => {
    twitchSessionFetchInFlight = null;
  });

  return twitchSessionFetchInFlight;
}

async function fetchDropsSnapshotFromApi(forceSessionRefresh = false): Promise<DropsSnapshot | null> {
  const session = await ensureTwitchSession(forceSessionRefresh);
  if (!session) {
    logWarn('Drops snapshot API skipped: Twitch session missing');
    return null;
  }
  if (!session.userId) {
    logWarn('Twitch session has no userId — user may not be logged in', sessionDebugSummary(session));
  }

  logInfo('Fetching drops snapshot via API', {
    forceSessionRefresh,
    ...sessionDebugSummary(session),
  });

  const sessionWithIntegrity = await ensureSessionIntegrity(session);
  logInfo('Attempting Twitch drops snapshot request', {
    mode: sessionWithIntegrity.clientIntegrity ? 'primary-with-integrity' : 'primary-no-integrity',
    hasIntegrity: Boolean(sessionWithIntegrity.clientIntegrity),
    oauthTokenLength: sessionWithIntegrity.oauthToken?.length ?? 0,
    deviceIdSuffix: sessionWithIntegrity.deviceId ? sessionWithIntegrity.deviceId.slice(-6) : null,
  });
  let client = new TwitchApiClient(sessionWithIntegrity);
  try {
    const snapshot = await client.fetchDropsSnapshot();
    if (snapshot.games.length === 0 && snapshot.drops.length === 0) {
      logWarn('Drops snapshot API returned empty payload');
      return null;
    }
    logInfo('Drops snapshot API success', {
      games: snapshot.games.length,
      drops: snapshot.drops.length,
    });
    return snapshot;
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (message.includes('integrity')) {
      // Retry 1: refresh integrity token and retry
      const refreshedIntegritySession = await ensureSessionIntegrity(session, true);
      if (refreshedIntegritySession.clientIntegrity && refreshedIntegritySession.clientIntegrity !== sessionWithIntegrity.clientIntegrity) {
        logInfo('Attempting Twitch drops snapshot request', {
          mode: 'retry-refreshed-integrity',
          hasIntegrity: true,
          oauthTokenLength: refreshedIntegritySession.oauthToken?.length ?? 0,
          deviceIdSuffix: refreshedIntegritySession.deviceId ? refreshedIntegritySession.deviceId.slice(-6) : null,
        });
        try {
          client = new TwitchApiClient(refreshedIntegritySession);
          const retriedSnapshot = await client.fetchDropsSnapshot();
          if (retriedSnapshot.games.length === 0 && retriedSnapshot.drops.length === 0) {
            logWarn('Drops snapshot API retry returned empty payload');
            return null;
          }
          return retriedSnapshot;
        } catch (retryError) {
          console.error('Twitch API snapshot fetch failed after integrity refresh:', retryError);
        }
      }

      // Retry 2: strip integrity and try without it
      logInfo('Attempting Twitch drops snapshot request', {
        mode: 'retry-without-integrity',
        hasIntegrity: false,
        oauthTokenLength: session.oauthToken?.length ?? 0,
        deviceIdSuffix: session.deviceId ? session.deviceId.slice(-6) : null,
      });
      try {
        const sessionWithoutIntegrity: TwitchSession = { ...session, clientIntegrity: undefined };
        client = new TwitchApiClient(sessionWithoutIntegrity);
        const fallbackSnapshot = await client.fetchDropsSnapshot();
        if (fallbackSnapshot.games.length === 0 && fallbackSnapshot.drops.length === 0) {
          logWarn('Drops snapshot API retry (no integrity) returned empty payload');
          return null;
        }
        return fallbackSnapshot;
      } catch (fallbackError) {
        console.error('Twitch API snapshot fetch failed without integrity fallback:', fallbackError);
      }
    }
    if (isLikelyAuthError(error)) {
      clearTwitchSessionCache();
      if (!forceSessionRefresh) {
        return fetchDropsSnapshotFromApi(true);
      }
    }
    console.error('Twitch API snapshot fetch failed:', error);
    return null;
  }
}

async function fetchDirectoryStreamersFromApi(game: TwitchGame, forceSessionRefresh = false): Promise<TwitchStreamer[]> {
  const session = await ensureTwitchSession(forceSessionRefresh);
  if (!session) {
    logWarn('Directory streamers fetch: session missing, using public client');
  }

  const client = new TwitchApiClient(
    session ?? {
      oauthToken: 'public',
      userId: 'public',
      deviceId: 'public',
      uuid: 'public',
    },
  );
  try {
    const streamers = await client.fetchDirectoryStreamers(game.name, game.categorySlug ?? toSlug(game.name));
    logInfo('Directory streamers fetched', {
      game: game.name,
      categorySlug: game.categorySlug ?? toSlug(game.name),
      count: streamers.length,
    });
    return streamers;
  } catch (error) {
    if (session && isLikelyAuthError(error)) {
      clearTwitchSessionCache();
      if (!forceSessionRefresh) {
        return fetchDirectoryStreamersFromApi(game, true);
      }
    }
    console.error('Twitch API directory fetch failed:', error);
    return [];
  }
}

async function fetchDropsSnapshot(selectedGameName = appState.selectedGame?.name ?? ''): Promise<DropsSnapshot | null> {
  const tabId = await ensureDropsTab();
  if (!tabId) {
    return null;
  }

  const send = async () =>
    chrome.tabs.sendMessage(tabId, {
      type: 'FETCH_DROPS_DATA',
      payload: { selectedGameName },
    });
  try {
    await waitForTabComplete(tabId, 12_000);
    await ensureContentScriptOnTab(tabId);
    await new Promise((resolve) => setTimeout(resolve, 1200));

    let response: any;
    try {
      response = await send();
    } catch {
      await ensureContentScriptOnTab(tabId);
      await new Promise((resolve) => setTimeout(resolve, 1200));
      response = await send().catch(() => null);
      if (!response) {
        await chrome.tabs.reload(tabId).catch(() => undefined);
        await waitForTabComplete(tabId, 12_000);
        await ensureContentScriptOnTab(tabId);
        await new Promise((resolve) => setTimeout(resolve, 1200));
        response = await send().catch(() => null);
      }
    }

    if (!response?.success || !response.snapshot) {
      return null;
    }

    return response.snapshot as DropsSnapshot;
  } finally {
    await closeDropsTab(tabId);
  }
}

async function fetchStreamContext(tabId: number): Promise<StreamContext | null> {
  const send = async () => chrome.tabs.sendMessage(tabId, { type: 'GET_STREAM_CONTEXT' });
  let response: any;
  try {
    response = await send();
  } catch {
    await ensureContentScriptOnTab(tabId);
    response = await send().catch(() => null);
  }
  if (!response?.success || !response.context) {
    return null;
  }
  return response.context as StreamContext;
}

async function ensureInventoryTab(): Promise<number | null> {
  const targetUrl = inventoryUrl();
  const existingManaged = await ensureManagedTab(appState.inventoryTabId, targetUrl, false);
  if (existingManaged) {
    appState.inventoryTabId = existingManaged;
    return existingManaged;
  }

  const workspaceWindowId = await getWorkspaceWindowId();
  const queryBase = workspaceWindowId ? { windowId: workspaceWindowId } : {};
  const tabs = await chrome.tabs.query({
    ...queryBase,
    url: ['https://www.twitch.tv/drops/inventory*', 'https://twitch.tv/drops/inventory*'],
  });
  if (tabs[0]?.id) {
    appState.inventoryTabId = tabs[0].id;
    if (tabs[0].url !== targetUrl) {
      await chrome.tabs.update(tabs[0].id, { url: targetUrl, active: false }).catch(() => undefined);
    }
    return tabs[0].id;
  }

  const created = await createManagedTab(targetUrl, false);
  appState.inventoryTabId = created?.id ?? null;
  return created?.id ?? null;
}

async function waitForTabComplete(tabId: number, timeoutMs = 12_000): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      resolve();
    };

    const onUpdated = (updatedTabId: number, info: chrome.tabs.TabChangeInfo) => {
      if (updatedTabId === tabId && info.status === 'complete') {
        finish();
      }
    };

    const timer = setTimeout(finish, timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === 'complete') {
        finish();
      }
    }).catch(() => finish());
  });
}

async function fetchGamesFromHiddenDropsTab(): Promise<TwitchGame[]> {
  let hiddenWindowId: number | null = null;
  let tabId: number | null = null;
  const hiddenWindow = await chrome.windows
    .create({
      url: 'https://www.twitch.tv/drops/campaigns',
      focused: false,
      state: 'minimized',
    })
    .catch(() => null);

  if (hiddenWindow?.id) {
    hiddenWindowId = hiddenWindow.id;
    tabId = hiddenWindow.tabs?.find((tab) => Boolean(tab.id))?.id ?? null;
  }

  if (!tabId && hiddenWindowId) {
    const tabs = await chrome.tabs.query({ windowId: hiddenWindowId }).catch(() => []);
    tabId = tabs.find((tab) => Boolean(tab.id))?.id ?? null;
  }

  if (!tabId) {
    if (hiddenWindowId) {
      await chrome.windows.remove(hiddenWindowId).catch(() => undefined);
    }
    return [];
  }

  const send = async () => chrome.tabs.sendMessage(tabId as number, { type: 'FETCH_GAMES' });
  try {
    await waitForTabComplete(tabId, 15_000);
    await ensureContentScriptOnTab(tabId);
    await new Promise((resolve) => setTimeout(resolve, 1200));

    let response: any = await send().catch(() => null);
    if (!response?.success) {
      await ensureContentScriptOnTab(tabId);
      response = await send().catch(() => null);
    }
    if (!response?.success) {
      await chrome.tabs.reload(tabId).catch(() => undefined);
      await waitForTabComplete(tabId, 12_000);
      await ensureContentScriptOnTab(tabId);
      await new Promise((resolve) => setTimeout(resolve, 900));
      response = await send().catch(() => null);
    }

    return response?.success && Array.isArray(response.games) ? (response.games as TwitchGame[]) : [];
  } finally {
    if (hiddenWindowId) {
      await chrome.windows.remove(hiddenWindowId).catch(() => undefined);
    } else {
      await chrome.tabs.remove(tabId).catch(() => undefined);
    }
  }
}

async function refreshGamesCacheFromHiddenFetch(): Promise<TwitchGame[]> {
  if (gamesCacheRefreshInFlight) {
    return gamesCacheRefreshInFlight;
  }

  gamesCacheRefreshInFlight = (async () => {
    let fetchedGames: TwitchGame[] = [];
    const apiSnapshot = await fetchDropsSnapshotFromApi();
    if (apiSnapshot?.games?.length) {
      fetchedGames = apiSnapshot.games;
      if (apiSnapshot.drops.length > 0) {
        cachedDropsSnapshot = apiSnapshot.drops;
      }
    } else if (ENABLE_CONTENT_FALLBACK) {
      fetchedGames = await fetchGamesFromHiddenDropsTab();
    }

    const mergedGames = mergeAvailableGames(appState.availableGames, fetchedGames);
    appState.availableGames = mergedGames;
    normalizeGameSelection(mergedGames);
    normalizeQueueSelection(mergedGames);
    gamesCacheLastFetchedAt = Date.now();
    await chrome.storage.local.set({ gamesCacheLastFetchedAt });
    await saveState();
    return mergedGames;
  })().finally(() => {
    gamesCacheRefreshInFlight = null;
  });

  return gamesCacheRefreshInFlight;
}

async function refreshInventoryTabForFreshData(tabId: number) {
  const inventoryTab = await chrome.tabs.get(tabId).catch(() => null);
  const inventoryWasActive = Boolean(inventoryTab?.active);
  await chrome.tabs.reload(tabId).catch(() => undefined);
  await waitForTabComplete(tabId, 10_000);
  await ensureContentScriptOnTab(tabId);
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (inventoryWasActive && appState.tabId) {
    await chrome.tabs.update(appState.tabId, { active: true }).catch(() => undefined);
  }
}

async function fetchInventoryDrops(selectedGameName: string, selectedGameImage?: string): Promise<TwitchDrop[]> {
  const tabId = await ensureInventoryTab();
  if (!tabId) {
    return [];
  }

  const send = async () =>
    chrome.tabs.sendMessage(tabId, {
      type: 'FETCH_INVENTORY_DATA',
      payload: { selectedGameName, selectedGameImage: selectedGameImage ?? '' },
    });

  const readDropsWithRetry = async (attempts: number, waitMs: number): Promise<TwitchDrop[]> => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const response: any = await send().catch(() => null);
      if (response?.success && Array.isArray(response.drops)) {
        const drops = response.drops as TwitchDrop[];
        if (drops.length > 0) {
          return drops;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    return [];
  };

  try {
    await refreshInventoryTabForFreshData(tabId);
    const freshDrops = await readDropsWithRetry(6, 1000);
    if (freshDrops.length > 0) {
      return freshDrops;
    }
  } catch {
    await ensureContentScriptOnTab(tabId);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const recoveryDrops = await readDropsWithRetry(3, 1200);
    if (recoveryDrops.length > 0) {
      return recoveryDrops;
    }
  }

  return [];
}

function mergeDropsWithInventory(campaignDrops: TwitchDrop[], inventoryDrops: TwitchDrop[]): TwitchDrop[] {
  if (inventoryDrops.length === 0) {
    return campaignDrops;
  }

  const merged = campaignDrops.map((drop) => {
    const match = inventoryDrops
      .map((candidate) => ({ candidate, score: scoreDropMatch(drop, candidate) }))
      .sort((a, b) => b.score - a.score)[0];

    if (!match || match.score < 70) {
      return drop;
    }

    const inventoryDrop = match.candidate;
    const mergedProgress = inventoryDrop.progressSource === 'inventory' ? inventoryDrop.progress : Math.max(drop.progress, inventoryDrop.progress);
    const mergedClaimed = drop.claimed || inventoryDrop.claimed;
    const mergedClaimable = Boolean(drop.claimable) || Boolean(inventoryDrop.claimable);
    const mergedRequiredMinutes = inventoryDrop.requiredMinutes ?? drop.requiredMinutes ?? null;
    const mergedRemainingMinutes =
      inventoryDrop.remainingMinutes ??
      (typeof mergedRequiredMinutes === 'number' && Number.isFinite(mergedRequiredMinutes)
        ? Math.max(0, Math.round((mergedRequiredMinutes * (100 - mergedProgress)) / 100))
        : drop.remainingMinutes ?? null);

    return {
      ...drop,
      progress: mergedProgress,
      claimed: mergedClaimed,
      claimable: mergedClaimable,
      imageUrl: drop.imageUrl || inventoryDrop.imageUrl,
      campaignId: drop.campaignId || inventoryDrop.campaignId,
      requiredMinutes: mergedRequiredMinutes,
      remainingMinutes: mergedRemainingMinutes,
      progressSource: inventoryDrop.progressSource ?? drop.progressSource,
      status: (mergedClaimed ? 'completed' : mergedClaimable ? 'pending' : mergedProgress > 0 ? 'active' : 'pending') as DropStatus,
    };
  });

  const mergedKeys = new Set(merged.map((drop) => `${normalizeToken(drop.gameName)}::${normalizeToken(drop.name)}::${normalizeToken(drop.imageUrl)}`));
  const selectedGameName = normalizeToken(appState.selectedGame?.name ?? '');
  const extras = inventoryDrops.filter((drop) => {
    const key = `${normalizeToken(drop.gameName)}::${normalizeToken(drop.name)}::${normalizeToken(drop.imageUrl)}`;
    if (mergedKeys.has(key)) {
      return false;
    }
    if (!drop.claimed) {
      return true;
    }
    return Boolean(selectedGameName && normalizeToken(drop.gameName) === selectedGameName);
  });

  return [...merged, ...extras];
}

function isSameGame(left: TwitchGame, right: TwitchGame): boolean {
  return left.id === right.id || sameCampaignId(left.campaignId, right.campaignId) || gameKey(left) === gameKey(right);
}

function queueContainsGame(game: TwitchGame): boolean {
  return appState.queue.some((queuedGame) => isSameGame(queuedGame, game));
}

function removeGameFromQueue(game: TwitchGame) {
  appState.queue = appState.queue.filter((queuedGame) => !isSameGame(queuedGame, game));
}

function resolveGameFromState(game: TwitchGame): TwitchGame {
  const resolved = findMatchingGame(game, appState.availableGames);
  if (resolved) {
    if (resolved.id !== game.id || resolved.campaignId !== game.campaignId) {
      logInfo('Resolved selected game to canonical campaign', {
        inputId: game.id,
        inputCampaignId: game.campaignId ?? null,
        inputName: game.name,
        resolvedId: resolved.id,
        resolvedCampaignId: resolved.campaignId ?? null,
        resolvedName: resolved.name,
      });
    }
    return resolved;
  }

  const byNameCandidates = appState.availableGames.filter((candidate) => normalizeToken(candidate.name) === normalizeToken(game.name));
  const byNamePreferred = choosePreferredGame(byNameCandidates);
  if (byNamePreferred) {
    logInfo('Resolved selected game by exact name fallback', {
      inputId: game.id,
      inputCampaignId: game.campaignId ?? null,
      resolvedId: byNamePreferred.id,
      resolvedCampaignId: byNamePreferred.campaignId ?? null,
      name: game.name,
    });
    return byNamePreferred;
  }

  return game;
}

function evaluateDropsForGame(game: TwitchGame, drops: TwitchDrop[]): { allDrops: TwitchDrop[]; pendingDrops: TwitchDrop[] } {
  const relevantDrops = drops.filter((drop) => dropMatchesSelectedGame(drop, game));
  const allDrops = relevantDrops;
  const pendingDrops = allDrops.filter((drop) => !isDropCompleted(drop));
  return { allDrops, pendingDrops };
}

async function inspectGameProgress(game: TwitchGame): Promise<{
  resolvedGame: TwitchGame;
  allDrops: TwitchDrop[];
  pendingDrops: TwitchDrop[];
}> {
  const initialGame = resolveGameFromState(game);
  const snapshot = await fetchDropsSnapshotFromApi();
  if (snapshot?.games?.length) {
    appState.availableGames = mergeAvailableGames(appState.availableGames, snapshot.games);
    normalizeQueueSelection(appState.availableGames);
  }

  const resolvedGame = resolveGameFromState(initialGame);
  const candidateDrops = snapshot?.drops ?? cachedDropsSnapshot;

  return {
    resolvedGame,
    ...evaluateDropsForGame(resolvedGame, candidateDrops),
  };
}

async function openDirectoryTab(categorySlug: string): Promise<number | null> {
  const created = await createManagedTab(directoryUrl(categorySlug), false);
  appState.directoryTabId = created?.id ?? null;
  return created?.id ?? null;
}

async function closeDirectoryTab(tabId: number) {
  await chrome.tabs.remove(tabId).catch(() => undefined);
  if (appState.directoryTabId === tabId) {
    appState.directoryTabId = null;
  }
}

async function fetchDirectoryStreamers(categorySlug: string): Promise<TwitchStreamer[]> {
  const tabId = await openDirectoryTab(categorySlug);
  if (!tabId) {
    return [];
  }

  try {
    const send = async () => chrome.tabs.sendMessage(tabId, { type: 'GET_DIRECTORY_STREAMERS' });
    await waitForTabComplete(tabId, 12_000);
    await ensureContentScriptOnTab(tabId);
    await new Promise((resolve) => setTimeout(resolve, 1500));

    let response: any = await send().catch(() => null);
    if (!response?.success) {
      await ensureContentScriptOnTab(tabId);
      response = await send().catch(() => null);
    }
    if (!response?.success) {
      await chrome.tabs.reload(tabId).catch(() => undefined);
      await waitForTabComplete(tabId, 10_000);
      await ensureContentScriptOnTab(tabId);
      await new Promise((resolve) => setTimeout(resolve, 900));
      response = await send().catch(() => null);
    }

    return response?.success ? (response.streamers as TwitchStreamer[]) : [];
  } finally {
    await closeDirectoryTab(tabId);
  }
}

async function focusTabWindow(tabId: number) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.windowId) {
    return;
  }
  await chrome.windows.update(tab.windowId, { focused: true }).catch(() => undefined);
}

async function fetchCategorySuggestions(gameName: string): Promise<Array<{ slug: string; label: string }>> {
  const tab = await createManagedTab(`https://www.twitch.tv/search?term=${encodeURIComponent(gameName)}`, false);
  if (!tab?.id) {
    return [];
  }

  await waitForTabComplete(tab.id, 12_000);
  await ensureContentScriptOnTab(tab.id);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_CATEGORY_SUGGESTIONS' }).catch(() => null);
  await chrome.tabs.remove(tab.id).catch(() => undefined);
  if (!response?.success || !Array.isArray(response.categories)) {
    return [];
  }
  return response.categories as Array<{ slug: string; label: string }>;
}

async function resolveCategorySlug(game: TwitchGame): Promise<string> {
  if (game.categorySlug) {
    return game.categorySlug;
  }

  const updated = appState.availableGames.find((item) => item.id === game.id || sameCampaignId(item.campaignId, game.campaignId));
  if (updated?.categorySlug) {
    return updated.categorySlug;
  }

  return toSlug(game.name);
}

async function openMutedChannel(streamer: TwitchStreamer) {
  const channelName = streamer.name.toLowerCase();
  const displayName = streamer.displayName || channelName;
  const targetUrl = streamerWatchUrl(channelName);
  const managedTabId = await ensureManagedTab(appState.tabId, targetUrl, true);
  if (!managedTabId) {
    return;
  }

  const prepareAudioWithRetry = async () => {
    await focusTabWindow(managedTabId);
    await chrome.tabs.update(managedTabId, { active: true, muted: false }).catch(() => undefined);
    await waitForTabComplete(managedTabId, 15_000).catch(() => undefined);
    await ensureContentScriptOnTab(managedTabId);

    let audioReady = false;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const prepared: any = await chrome.tabs
        .sendMessage(managedTabId, {
          type: 'PREPARE_STREAM_PLAYBACK',
        })
        .catch(() => null);
      if (prepared?.isAudioReady) {
        audioReady = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 900));
      await focusTabWindow(managedTabId);
      await chrome.tabs.update(managedTabId, { active: true, muted: false }).catch(() => undefined);
    }

    if (!audioReady) {
      try {
        await chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: 'Audio blocked by browser',
          message: 'Chrome blocked autoplay audio. Click once on the Twitch player to unmute.',
          priority: 1,
        });
      } catch {
        // Ignore notification failures.
      }
    }
  };

  void prepareAudioWithRetry().catch(() => undefined);
  appState.tabId = managedTabId;
  appState.activeStreamer = {
    id: channelName,
    name: channelName,
    displayName,
    isLive: true,
    viewerCount: streamer.viewerCount,
  };
  invalidStreamChecks = 0;
  streamValidationGraceUntil = Date.now() + STREAM_VALIDATION_GRACE_MS;
}

async function enforcePlaybackPolicyOnStreamTab() {
  if (!appState.tabId) {
    return;
  }
  const tab = await chrome.tabs.get(appState.tabId).catch(() => null);
  if (!tab?.id) {
    return;
  }
  await ensureContentScriptOnTab(tab.id);
  const prepared: any = await chrome.tabs
    .sendMessage(tab.id, {
      type: 'PREPARE_STREAM_PLAYBACK',
    })
    .catch(() => null);
  if (!prepared?.isAudioReady) {
    await new Promise((resolve) => setTimeout(resolve, 700));
    await chrome.tabs
      .sendMessage(tab.id, {
        type: 'PREPARE_STREAM_PLAYBACK',
      })
      .catch(() => undefined);
  }
}

async function sendAlert(kind: 'drop-complete' | 'all-complete', message: string) {
  await chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: kind === 'all-complete' ? 'All drops completed' : 'Drop completed',
    message,
    priority: 2,
  });

  const tabs = await chrome.tabs.query({ url: ['https://www.twitch.tv/*', 'https://twitch.tv/*'] });
  await Promise.all(
    tabs
      .filter((tab) => Boolean(tab.id))
      .map((tab) =>
        chrome.tabs.sendMessage(tab.id as number, {
          type: 'PLAY_ALERT',
          payload: { kind, message },
        }).catch(() => undefined)
      )
  );
}

async function evaluateDropTransitions(previousCompletedIds: Set<string>) {
  const nowCompleted = new Set(appState.completedDrops.map((drop) => drop.id));
  const newlyCompleted = appState.completedDrops.filter((drop) => !previousCompletedIds.has(drop.id));

  for (const drop of newlyCompleted) {
    await sendAlert('drop-complete', `Reward unlocked: ${drop.name}`);
  }

  const hasDrops = appState.allDrops.length > 0;
  const allCompleted = hasDrops && appState.pendingDrops.length === 0 && appState.currentDrop === null;
  if (allCompleted && !appState.completionNotified) {
    await sendAlert('all-complete', `All rewards for ${appState.selectedGame?.name ?? 'this campaign'} are complete.`);
    appState.completionNotified = true;
  }

  if (nowCompleted.size < previousCompletedIds.size) {
    appState.completionNotified = false;
  }
}

function canRetryDropClaim(claimId: string): boolean {
  const retryAt = dropClaimRetryAtById.get(claimId) ?? 0;
  return Date.now() >= retryAt;
}

function markDropClaimedLocally(claimId: string, fallbackDropId?: string): boolean {
  let changed = false;
  appState.allDrops = appState.allDrops.map((drop) => {
    const isMatch = drop.claimId === claimId || (fallbackDropId ? drop.id === fallbackDropId : false);
    if (!isMatch) {
      return drop;
    }
    changed = true;
    return {
      ...drop,
      claimed: true,
      claimable: false,
      progress: 100,
      remainingMinutes: 0,
      status: 'completed',
    };
  });

  if (changed) {
    splitDropsForSelectedGame(appState.allDrops);
  }

  return changed;
}

async function claimDropViaApi(drop: TwitchDrop): Promise<boolean> {
  const claimId = (drop.claimId ?? '').trim();
  if (!claimId) {
    logWarn('Auto-claim skipped: missing claimId', { dropId: drop.id, dropName: drop.name });
    return false;
  }

  if (!canRetryDropClaim(claimId)) {
    logInfo('Auto-claim cooldown active', { claimId, dropName: drop.name });
    return false;
  }

  const tryClaim = async (forceSessionRefresh: boolean): Promise<boolean> => {
    const session = await ensureTwitchSession(forceSessionRefresh);
    if (!session) {
      logWarn('Auto-claim skipped: Twitch session unavailable', { claimId, dropName: drop.name });
      return false;
    }
    const sessionWithIntegrity = await ensureSessionIntegrity(session);
    const client = new TwitchApiClient(sessionWithIntegrity);
    return client.claimDropReward(claimId);
  };

  try {
    logInfo('Auto-claim attempt', { claimId, dropName: drop.name, game: drop.gameName });
    const claimed = await tryClaim(false);
    if (!claimed) {
      dropClaimRetryAtById.set(claimId, Date.now() + DROP_CLAIM_RETRY_COOLDOWN_MS);
      logWarn('Auto-claim did not complete, scheduled retry', { claimId, dropName: drop.name });
      return false;
    }
    dropClaimRetryAtById.delete(claimId);
    logInfo('Auto-claim success', { claimId, dropName: drop.name });
    return true;
  } catch (error) {
    if (isLikelyAuthError(error)) {
      clearTwitchSessionCache();
      try {
        const claimedAfterRefresh = await tryClaim(true);
        if (claimedAfterRefresh) {
          dropClaimRetryAtById.delete(claimId);
          return true;
        }
      } catch (secondError) {
        console.error('Drop claim retry failed after refreshing Twitch session:', secondError);
      }
    } else {
      console.error('Drop claim failed:', error);
    }

    dropClaimRetryAtById.set(claimId, Date.now() + DROP_CLAIM_RETRY_COOLDOWN_MS);
    logWarn('Auto-claim failed, scheduled retry', { claimId, dropName: drop.name, error: String(error) });
    return false;
  }
}

async function autoClaimClaimableDrops(): Promise<boolean> {
  if (dropClaimInFlight) {
    return false;
  }

  const claimTargets = appState.pendingDrops
    .filter((drop) => Boolean(drop.claimable) && !drop.claimed)
    .filter((drop) => Boolean((drop.claimId ?? '').trim()));

  if (claimTargets.length === 0) {
    return false;
  }

  dropClaimInFlight = true;
  let claimedAny = false;
  try {
    for (const drop of claimTargets) {
      const claimed = await claimDropViaApi(drop);
      if (!claimed || !drop.claimId) {
        continue;
      }
      const changed = markDropClaimedLocally(drop.claimId, drop.id);
      if (changed) {
        claimedAny = true;
      }
    }

    if (claimedAny) {
      await saveState();
    }

    return claimedAny;
  } finally {
    dropClaimInFlight = false;
  }
}

interface RefreshDropsOptions {
  includeCampaignFetch?: boolean;
  includeInventoryFetch?: boolean;
  forceInventoryFetch?: boolean;
}

async function refreshDropsData(options: RefreshDropsOptions = {}) {
  const includeCampaignFetch = options.includeCampaignFetch ?? false;
  const includeInventoryFetch = options.includeInventoryFetch ?? appState.isRunning;
  const forceInventoryFetch = options.forceInventoryFetch ?? false;
  const previousCompletedIds = new Set(appState.completedDrops.map((drop) => drop.id));
  let games = appState.availableGames;
  let drops = includeCampaignFetch ? (cachedDropsSnapshot.length > 0 ? cachedDropsSnapshot : appState.allDrops) : appState.allDrops;
  let apiSnapshotUsed = false;
  const selectedGame = appState.selectedGame;
  logInfo('Starting drops refresh', {
    includeCampaignFetch,
    includeInventoryFetch,
    forceInventoryFetch,
    selectedGame: selectedGame?.name ?? null,
    cachedDrops: cachedDropsSnapshot.length,
    currentAllDrops: appState.allDrops.length,
  });

  if (includeCampaignFetch || includeInventoryFetch) {
    const apiSnapshot = await fetchDropsSnapshotFromApi();
    if (apiSnapshot) {
      games = mergeAvailableGames(appState.availableGames, apiSnapshot.games);
      drops = apiSnapshot.drops;
      if (apiSnapshot.drops.length > 0) {
        cachedDropsSnapshot = apiSnapshot.drops;
      }
      apiSnapshotUsed = true;
    }
  }

  if (ENABLE_CONTENT_FALLBACK && includeCampaignFetch && !apiSnapshotUsed) {
    const snapshot = await fetchDropsSnapshot();
    if (snapshot) {
      games = mergeAvailableGames(appState.availableGames, snapshot.games);
      drops = snapshot.drops;
    }
  }

  const shouldFetchInventory =
    ENABLE_CONTENT_FALLBACK &&
    includeInventoryFetch &&
    selectedGame?.name &&
    (!appState.isRunning || forceInventoryFetch || Date.now() - lastInventoryRefreshAt >= INVENTORY_REFRESH_INTERVAL_MS);
  if (shouldFetchInventory && selectedGame) {
    const inventoryDrops = await fetchInventoryDrops(selectedGame.name, selectedGame.imageUrl);
    lastInventoryRefreshAt = Date.now();
    if (inventoryDrops.length > 0) {
      const baseDrops = drops.length > 0 ? drops : appState.allDrops;
      drops = mergeDropsWithInventory(baseDrops, inventoryDrops);
    }
  }

  if (!includeCampaignFetch && !includeInventoryFetch && drops.length === 0 && appState.allDrops.length > 0) {
    drops = appState.allDrops;
  }

  if (includeCampaignFetch && !apiSnapshotUsed && cachedDropsSnapshot.length > 0) {
    logWarn('Using cached drops snapshot because API refresh failed', {
      cachedDrops: cachedDropsSnapshot.length,
      selectedGame: selectedGame?.name ?? null,
    });
  }

  updateStateFromSnapshot({
    games,
    drops,
    updatedAt: Date.now(),
  });
  logInfo('Drops data refresh', {
    includeCampaignFetch,
    includeInventoryFetch,
    forceInventoryFetch,
    apiSnapshotUsed,
    games: games.length,
    drops: drops.length,
    selectedGame: appState.selectedGame?.name ?? null,
  });
  await evaluateDropTransitions(previousCompletedIds);
  await saveState();
}

async function checkDropProgress() {
  if (!appState.isRunning || appState.isPaused) {
    return;
  }

  if (monitorTickInFlight) {
    return;
  }
  monitorTickInFlight = true;

  try {
    if (appState.tabId) {
      const streamTab = await chrome.tabs.get(appState.tabId).catch(() => null);
      if (!streamTab) {
        appState.tabId = null;
        appState.activeStreamer = null;
      }
    }
    await enforcePlaybackPolicyOnStreamTab();
    await rotateStreamerIfInvalid();
    await refreshDropsData();
    const claimedAny = await autoClaimClaimableDrops();
    if (claimedAny) {
      await refreshDropsData({ includeCampaignFetch: true, includeInventoryFetch: true, forceInventoryFetch: true });
    }
    await advanceQueueIfCompleted();
  } finally {
    monitorTickInFlight = false;
  }
}

function startMonitoring() {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
  }
  monitoringInterval = setInterval(() => {
    checkDropProgress().catch((error) => console.error('Monitoring error:', error));
  }, PROGRESS_POLL_MS);
  checkDropProgress().catch((error) => console.error('Initial monitoring error:', error));
}

function stopMonitoring() {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
  }
}

async function openBestStreamerForSelectedGame(): Promise<boolean> {
  if (!appState.selectedGame) {
    logWarn('Unable to open streamer: no selected game');
    return false;
  }

  const resolvedSlug = await resolveCategorySlug(appState.selectedGame);
  appState.selectedGame = {
    ...appState.selectedGame,
    categorySlug: resolvedSlug,
  };

  const streamers = await fetchDirectoryStreamersFromApi(appState.selectedGame);
  const streamer = streamers.find((item) => item.viewerCount !== undefined && item.viewerCount < Number.MAX_SAFE_INTEGER) ?? streamers[0];
  if (streamer) {
    logInfo('Opening selected streamer', {
      game: appState.selectedGame.name,
      streamer: streamer.name,
      viewers: streamer.viewerCount ?? null,
      candidates: streamers.length,
    });
    await openMutedChannel(streamer);
    return true;
  }

  logWarn('No streamer found for selected game', {
    game: appState.selectedGame.name,
    categorySlug: appState.selectedGame.categorySlug ?? null,
  });
  appState.tabId = null;
  appState.activeStreamer = null;
  return false;
}

async function ensureWorkspaceForSelectedGame(options: { cleanupExternalTabs?: boolean } = {}) {
  if (!appState.selectedGame) {
    return;
  }
  const resolvedSlug = await resolveCategorySlug(appState.selectedGame);
  appState.selectedGame = {
    ...appState.selectedGame,
    categorySlug: resolvedSlug,
  };

  if (options.cleanupExternalTabs && ENABLE_CONTENT_FALLBACK) {
    await closeUtilityTabsOutsideWorkspace();
  }
}

function pushGameToQueue(game: TwitchGame) {
  if (queueContainsGame(game)) {
    return;
  }
  appState.queue = [...appState.queue, game];
}

async function advanceQueueIfCompleted(): Promise<boolean> {
  if (!appState.isRunning || appState.isPaused) {
    return false;
  }

  const knownCompletedCurrent = appState.allDrops.length > 0 && appState.pendingDrops.length === 0 && appState.currentDrop === null;
  if (!knownCompletedCurrent) {
    return true;
  }

  if (appState.selectedGame) {
    removeGameFromQueue(appState.selectedGame);
  }

  while (appState.queue.length > 0) {
    const nextGame = resolveGameFromState(appState.queue[0]);
    appState.selectedGame = nextGame;
    appState.completionNotified = false;
    invalidStreamChecks = 0;

    await ensureWorkspaceForSelectedGame({ cleanupExternalTabs: true });
    await refreshDropsData({ includeCampaignFetch: true, includeInventoryFetch: true });

    const knownCompletedNext = appState.allDrops.length > 0 && appState.pendingDrops.length === 0 && appState.currentDrop === null;
    if (knownCompletedNext) {
      removeGameFromQueue(nextGame);
      continue;
    }

    await openBestStreamerForSelectedGame();
    await saveState();
    return true;
  }

  if (appState.tabId) {
    await chrome.tabs.remove(appState.tabId).catch(() => undefined);
  }
  appState.tabId = null;
  appState.activeStreamer = null;
  appState.isRunning = false;
  appState.isPaused = false;
  appState.selectedGame = null;
  appState.completionNotified = false;
  stopMonitoring();
  await sendAlert('all-complete', 'Queue completed. No pending rewards left.');
  await saveState();
  return false;
}

async function handleStartFarming(payload: { game?: TwitchGame }) {
  if (!payload?.game) {
    return { success: false, error: 'No game selected.' };
  }

  const requestedGame = resolveGameFromState(payload.game);
  removeGameFromQueue(requestedGame);
  appState.queue = [requestedGame, ...appState.queue];
  normalizeQueueSelection(appState.availableGames);
  appState.selectedGame = appState.queue[0] ?? requestedGame;
  appState.isRunning = true;
  appState.isPaused = false;
  appState.completionNotified = false;
  appState.workspaceWindowId = null;
  appState.directoryTabId = null;
  appState.dropsTabId = null;
  appState.inventoryTabId = null;
  invalidStreamChecks = 0;
  lastStreamRotationAt = 0;
  streamValidationGraceUntil = 0;
  lastInventoryRefreshAt = 0;
  dropClaimRetryAtById.clear();
  dropClaimInFlight = false;
  monitorTickInFlight = false;

  await openMonitorDashboardWindow().catch(() => undefined);
  await ensureWorkspaceForSelectedGame({ cleanupExternalTabs: true });
  await refreshDropsData({ includeCampaignFetch: true, includeInventoryFetch: true });
  const advanced = await advanceQueueIfCompleted();
  if (!advanced) {
    return { success: false, error: 'Queue completed. No pending rewards left.' };
  }
  if (!appState.tabId && appState.selectedGame) {
    await openBestStreamerForSelectedGame();
  }

  await saveState();
  startMonitoring();
  return { success: true };
}

async function rotateStreamerIfInvalid() {
  if (!appState.selectedGame) {
    return;
  }

  if (!appState.tabId) {
    await openBestStreamerForSelectedGame();
    await saveState();
    return;
  }

  const tab = await chrome.tabs.get(appState.tabId).catch(() => null);
  if (!tab?.id) {
    appState.tabId = null;
    appState.activeStreamer = null;
    await openBestStreamerForSelectedGame();
    await saveState();
    return;
  }

  const context = await fetchStreamContext(tab.id);
  if (!context) {
    // If we cannot inspect, avoid aggressive churn.
    return;
  }

  const now = Date.now();
  if (now < streamValidationGraceUntil) {
    return;
  }

  const sameChannel = !appState.activeStreamer || context.channelName === appState.activeStreamer.name;
  const hasDropsSignal = context.titleContainsDrops || context.hasDropsSignal;
  if (context.isLive && sameChannel && hasDropsSignal) {
    invalidStreamChecks = 0;
    return;
  }

  if (!context.isLive) {
    invalidStreamChecks += 3;
  } else if (!sameChannel) {
    invalidStreamChecks += 2;
  } else if (!hasDropsSignal) {
    invalidStreamChecks += 2;
  } else {
    invalidStreamChecks += 1;
  }
  if (invalidStreamChecks < INVALID_STREAM_THRESHOLD) {
    return;
  }

  if (now - lastStreamRotationAt < STREAM_ROTATE_COOLDOWN_MS) {
    return;
  }

  invalidStreamChecks = 0;
  lastStreamRotationAt = now;
  appState.activeStreamer = null;
  await openBestStreamerForSelectedGame();

  await saveState();
}

async function handleStopFarming() {
  stopMonitoring();
  invalidStreamChecks = 0;
  lastStreamRotationAt = 0;
  streamValidationGraceUntil = 0;
  lastInventoryRefreshAt = 0;
  dropClaimRetryAtById.clear();
  dropClaimInFlight = false;
  monitorTickInFlight = false;

  if (appState.tabId) {
    await chrome.tabs.remove(appState.tabId).catch(() => undefined);
  }

  appState = {
    ...appState,
    isRunning: false,
    isPaused: false,
    activeStreamer: null,
    tabId: null,
    completionNotified: false,
  };
  await saveState();
  return { success: true };
}

async function handleSetSelectedGame(payload: { game: TwitchGame }) {
  const selectedGame = resolveGameFromState(payload.game);
  logInfo('Selected game changed', {
    payloadGameId: payload.game.id,
    payloadCampaignId: payload.game.campaignId ?? null,
    payloadGameName: payload.game.name,
    gameId: selectedGame.id,
    campaignId: selectedGame.campaignId ?? null,
    gameName: selectedGame.name,
    running: appState.isRunning,
    availableGames: appState.availableGames.length,
  });
  appState.selectedGame = selectedGame;
  appState.completionNotified = false;
  if (appState.isRunning && !appState.isPaused) {
    removeGameFromQueue(selectedGame);
    appState.queue = [selectedGame, ...appState.queue];
  }
  if (appState.isRunning && !appState.isPaused) {
    await ensureWorkspaceForSelectedGame({ cleanupExternalTabs: true });
    await refreshDropsData({ includeCampaignFetch: true, includeInventoryFetch: true, forceInventoryFetch: true });
  } else {
    await refreshDropsData({ includeCampaignFetch: true, includeInventoryFetch: true, forceInventoryFetch: true });
  }
  if (appState.selectedGame) {
    const canonicalSelected = resolveGameFromState(appState.selectedGame);
    if (canonicalSelected.id !== appState.selectedGame.id || canonicalSelected.campaignId !== appState.selectedGame.campaignId) {
      logInfo('Selected game canonicalized after refresh', {
        previousId: appState.selectedGame.id,
        previousCampaignId: appState.selectedGame.campaignId ?? null,
        nextId: canonicalSelected.id,
        nextCampaignId: canonicalSelected.campaignId ?? null,
        name: canonicalSelected.name,
      });
      appState.selectedGame = canonicalSelected;
      splitDropsForSelectedGame(cachedDropsSnapshot.length > 0 ? cachedDropsSnapshot : appState.allDrops);
    }
  }
  if (appState.pendingDrops.length === 0 && appState.completedDrops.length === 0) {
    logWarn('No rewards found after selected game refresh', {
      selectedGame: appState.selectedGame?.name ?? null,
      cachedDrops: cachedDropsSnapshot.length,
    });
  }
  if (appState.isRunning && !appState.isPaused) {
    if (appState.tabId) {
      await chrome.tabs.remove(appState.tabId).catch(() => undefined);
    }
    appState.tabId = null;
    appState.activeStreamer = null;
    await openBestStreamerForSelectedGame();
  }
  await saveState();
  return { success: true };
}

async function handleAddToQueue(payload: { game?: TwitchGame }) {
  if (!payload?.game) {
    return { success: false, error: 'No game provided.' };
  }

  const targetGame = resolveGameFromState(payload.game);
  if (queueContainsGame(targetGame)) {
    return { success: true, added: false, reason: 'already-queued', game: targetGame };
  }

  const inspection = await inspectGameProgress(targetGame);
  if (inspection.allDrops.length > 0 && inspection.pendingDrops.length === 0) {
    await saveState();
    return {
      success: true,
      added: false,
      reason: 'already-completed',
      game: inspection.resolvedGame,
    };
  }

  pushGameToQueue(inspection.resolvedGame);
  await saveState();
  return {
    success: true,
    added: true,
    game: inspection.resolvedGame,
    queueLength: appState.queue.length,
  };
}

async function handleRemoveFromQueue(payload: { game?: TwitchGame; gameId?: string; campaignId?: string }) {
  const before = appState.queue.length;

  if (payload?.game) {
    removeGameFromQueue(payload.game);
  } else {
    const targetGameId = payload?.gameId;
    const targetCampaignId = payload?.campaignId;
    appState.queue = appState.queue.filter((game) => {
      if (targetGameId && game.id === targetGameId) {
        return false;
      }
      if (targetCampaignId && sameCampaignId(game.campaignId, targetCampaignId)) {
        return false;
      }
      return true;
    });
  }

  const removed = Math.max(0, before - appState.queue.length);
  await saveState();
  return { success: true, removed, queueLength: appState.queue.length };
}

async function handleClearQueue() {
  appState.queue = [];
  await saveState();
  return { success: true, queueLength: 0 };
}

async function handleEnsureGamesCache(payload?: { force?: boolean }) {
  await ensureStateHydratedForCache();
  const force = Boolean(payload?.force);
  const shouldRefresh = shouldRefreshGamesCache(force);
  if (shouldRefresh) {
    await refreshGamesCacheFromHiddenFetch();
  }
  return {
    success: true,
    refreshed: shouldRefresh,
    games: appState.availableGames,
    fetchedAt: gamesCacheLastFetchedAt,
  };
}

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  switch (message.type) {
    case 'ENSURE_GAMES_CACHE':
      handleEnsureGamesCache(message.payload)
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ success: false, error: String(error) }));
      return true;

    case 'ADD_TO_QUEUE':
      handleAddToQueue(message.payload)
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ success: false, error: String(error) }));
      return true;

    case 'REMOVE_FROM_QUEUE':
      handleRemoveFromQueue(message.payload)
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ success: false, error: String(error) }));
      return true;

    case 'CLEAR_QUEUE':
      handleClearQueue()
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ success: false, error: String(error) }));
      return true;

    case 'START_FARMING':
      handleStartFarming(message.payload)
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ success: false, error: String(error) }));
      return true;

    case 'SET_SELECTED_GAME':
      handleSetSelectedGame(message.payload)
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ success: false, error: String(error) }));
      return true;

    case 'PAUSE_FARMING':
      appState.isPaused = true;
      stopMonitoring();
      saveState().then(() => sendResponse({ success: true }));
      return true;

    case 'RESUME_FARMING':
      appState.isPaused = false;
      invalidStreamChecks = 0;
      startMonitoring();
      saveState().then(() => sendResponse({ success: true }));
      return true;

    case 'STOP_FARMING':
      handleStopFarming()
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ success: false, error: String(error) }));
      return true;

    case 'UPDATE_GAMES':
      appState.availableGames = mergeAvailableGames(appState.availableGames, message.payload ?? []);
      normalizeGameSelection(appState.availableGames);
      normalizeQueueSelection(appState.availableGames);
      gamesCacheLastFetchedAt = Date.now();
      chrome.storage.local.set({ gamesCacheLastFetchedAt }).catch(() => undefined);
      saveState().then(() => sendResponse({ success: true }));
      return true;

    case 'SYNC_DROPS_DATA':
      if (message.payload) {
        const previousCompletedIds = new Set(appState.completedDrops.map((drop) => drop.id));
        updateStateFromSnapshot(message.payload as DropsSnapshot);
        evaluateDropTransitions(previousCompletedIds)
          .then(() => saveState())
          .then(() => sendResponse({ success: true }));
        return true;
      }
      sendResponse({ success: false });
      return true;

    case 'SYNC_TWITCH_SESSION': {
      const incoming = sanitizeTwitchSession((message.payload as { session?: unknown } | undefined)?.session ?? message.payload);
      if (!incoming) {
        sendResponse({ success: false, error: 'Invalid session payload' });
        return true;
      }
      twitchSessionCache = incoming;
      persistTwitchSession(incoming)
        .then(() => {
          logInfo('Twitch session synced from content script', sessionDebugSummary(incoming));
          sendResponse({ success: true });
        })
        .catch((error) => sendResponse({ success: false, error: String(error) }));
      return true;
    }

    case 'REFRESH_DROPS':
      refreshDropsData({
        includeCampaignFetch: true,
        includeInventoryFetch: Boolean(appState.selectedGame?.name),
        forceInventoryFetch: true,
      })
        .then(() => sendResponse({ success: true }))
        .catch((error) => sendResponse({ success: false, error: String(error) }));
      return true;

    case 'OPEN_MONITOR_DASHBOARD':
      openMonitorDashboardWindow()
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ success: false, error: String(error) }));
      return true;

    default:
      sendResponse({ success: false, error: 'Unknown message type' });
      return true;
  }
});

chrome.tabs.onRemoved.addListener((removedTabId) => {
  let dirty = false;
  if (appState.tabId === removedTabId) {
    appState.tabId = null;
    appState.activeStreamer = null;
    dirty = true;
  }
  if (appState.directoryTabId === removedTabId) {
    appState.directoryTabId = null;
    dirty = true;
  }
  if (appState.dropsTabId === removedTabId) {
    appState.dropsTabId = null;
    dirty = true;
  }
  if (appState.inventoryTabId === removedTabId) {
    appState.inventoryTabId = null;
    dirty = true;
  }
  if (dirty) {
    saveState().catch(() => undefined);
  }
});

chrome.windows.onRemoved.addListener((removedWindowId) => {
  let dirty = false;
  if (appState.monitorWindowId === removedWindowId) {
    appState.monitorWindowId = null;
    dirty = true;
  }
  if (appState.workspaceWindowId !== removedWindowId) {
    if (dirty) {
      saveState().catch(() => undefined);
    }
    return;
  }
  clearWorkspaceReferences();
  saveState().catch(() => undefined);
});

console.log('DropHunter service worker loaded');
