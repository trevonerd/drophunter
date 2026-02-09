import { AppState, DropStatus, DropsSnapshot, Message, TwitchDrop, TwitchGame, TwitchStreamer } from '../types';

const DROPS_TAG_ID = 'c2542d6d-cd10-4532-919b-3d19f30a768b';
const PROGRESS_POLL_MS = 15_000;
const INVALID_STREAM_THRESHOLD = 5;
const STREAM_ROTATE_COOLDOWN_MS = 90_000;

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

chrome.runtime.onStartup.addListener(async () => {
  await loadState();
});

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'update') {
    appState = createInitialState();
    await chrome.storage.local.set({ appState });
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

function findMatchingGame(target: TwitchGame, source: TwitchGame[]): TwitchGame | null {
  const targetKey = gameKey(target);
  return (
    source.find((game) => game.id === target.id || sameCampaignId(game.campaignId, target.campaignId) || gameKey(game) === targetKey) ??
    null
  );
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
  return Array.from(merged.values())
    .filter((game) => !isExpiredGame(game))
    .sort((a, b) => a.name.localeCompare(b.name));
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
  const selectedCategory = normalizeToken(selected.categorySlug ?? '');
  const byId = drop.gameId === selected.id;
  const byCampaign = sameCampaignId(drop.campaignId, selected.campaignId);
  const byName = selectedName.length > 0 && normalizeToken(drop.gameName) === selectedName;
  const dropCategory = normalizeToken(drop.categorySlug ?? '');
  const byCategory = selectedCategory.length > 0 && dropCategory.length > 0 && selectedCategory === dropCategory;
  return byId || byCampaign || byName || byCategory;
}

function mergeDropProgressMonotonic(nextDrop: TwitchDrop, previousDrop: TwitchDrop): TwitchDrop {
  const mergedProgress = Math.max(nextDrop.progress, previousDrop.progress);
  const mergedClaimed = nextDrop.claimed || previousDrop.claimed;
  const mergedClaimable = Boolean(nextDrop.claimable) || Boolean(previousDrop.claimable);
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

  const relevant = allDrops.filter((drop) => dropMatchesSelectedGame(drop, selected));
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
    .filter((drop) => drop.claimed || Boolean(drop.claimable) || drop.progress > 0)
    .forEach((drop) => mergedRelevant.push(drop));

  const relevantForState = mergedRelevant.length > 0 ? mergedRelevant : previousRelevant;

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
}

function updateStateFromSnapshot(snapshot: DropsSnapshot) {
  const orderedGames = mergeAvailableGames(appState.availableGames, snapshot.games);
  appState.availableGames = orderedGames;
  normalizeGameSelection(orderedGames);
  normalizeQueueSelection(orderedGames);
  splitDropsForSelectedGame(snapshot.drops);
}

async function loadState() {
  try {
    const result = await chrome.storage.local.get(['appState']);
    if (result.appState) {
      appState = { ...createInitialState(), ...result.appState };
      if (!Array.isArray(appState.queue)) {
        appState.queue = [];
      }
    }
    if (appState.isRunning && !appState.isPaused) {
      startMonitoring();
    }
  } catch (error) {
    console.error('Error loading state:', error);
  }
}

async function saveState() {
  await chrome.storage.local.set({ appState });
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

function popoutPlayerUrl(channelName: string): string {
  const channel = encodeURIComponent(channelName.toLowerCase());
  return `https://player.twitch.tv/?channel=${channel}&enableExtensions=true&muted=false&player=popout&quality=160p30&volume=1&parent=twitch.tv&parent=www.twitch.tv`;
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
  const workspaceWindowId = await getWorkspaceWindowId();
  const shouldUseWorkspace = appState.isRunning || Boolean(workspaceWindowId);
  if (workspaceWindowId) {
    return chrome.tabs.create({
      windowId: workspaceWindowId,
      url,
      active,
    }).catch(() => null);
  }

  if (!shouldUseWorkspace) {
    // Before farming starts, avoid creating a dedicated workspace window.
    return chrome.tabs.create({ url, active }).catch(() => null);
  }

  const createdWindow = await chrome.windows.create({
    url,
    focused: false,
  }).catch(() => null);
  if (createdWindow?.id) {
    appState.workspaceWindowId = createdWindow.id;
    await notifyWorkspaceWindowCreated().catch(() => undefined);
    const createdTab = createdWindow.tabs?.[0] ?? null;
    if (createdTab?.id) {
      if (active && !createdTab.active) {
        await chrome.tabs.update(createdTab.id, { active: true }).catch(() => undefined);
      }
      return createdTab;
    }
    return chrome.tabs.create({
      windowId: createdWindow.id,
      url,
      active,
    }).catch(() => null);
  }

  return chrome.tabs.create({ url, active }).catch(() => null);
}

async function ensureManagedTab(existingTabId: number | null, targetUrl: string, active = false): Promise<number | null> {
  let workspaceWindowId = await getWorkspaceWindowId();
  const shouldUseWorkspace = appState.isRunning || Boolean(workspaceWindowId);

  if (existingTabId) {
    const existingTab = await chrome.tabs.get(existingTabId).catch(() => null);
    if (existingTab?.id) {
      if (!workspaceWindowId && shouldUseWorkspace) {
        const createdWindow = await chrome.windows.create({
          tabId: existingTab.id,
          focused: false,
        }).catch(() => null);
        if (createdWindow?.id) {
          appState.workspaceWindowId = createdWindow.id;
          workspaceWindowId = createdWindow.id;
          await notifyWorkspaceWindowCreated().catch(() => undefined);
        }
      }
      if (workspaceWindowId && shouldUseWorkspace && existingTab.windowId !== workspaceWindowId) {
        await chrome.tabs.move(existingTab.id, { windowId: workspaceWindowId, index: -1 }).catch(() => undefined);
      }
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

function compactSlug(value: string): string {
  return toSlug(value).replace(/-/g, '');
}

function streamGameMatchesSelection(context: StreamContext, selectedGame: TwitchGame): boolean {
  const streamSlug = compactSlug(context.categorySlug || context.categoryLabel);
  if (!streamSlug) {
    return true;
  }

  const selectedSlug = compactSlug(selectedGame.categorySlug ?? selectedGame.name);
  const selectedName = compactSlug(selectedGame.name);
  if (!selectedSlug && !selectedName) {
    return true;
  }

  return (
    streamSlug === selectedSlug ||
    streamSlug === selectedName ||
    streamSlug.includes(selectedSlug) ||
    selectedSlug.includes(streamSlug) ||
    streamSlug.includes(selectedName) ||
    selectedName.includes(streamSlug)
  );
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
  return findMatchingGame(game, appState.availableGames) ?? game;
}

function evaluateDropsForGame(game: TwitchGame, drops: TwitchDrop[]): { allDrops: TwitchDrop[]; pendingDrops: TwitchDrop[] } {
  const relevantDrops = drops.filter((drop) => dropMatchesSelectedGame(drop, game));
  const fallback = appState.allDrops.filter((drop) => dropMatchesSelectedGame(drop, game));
  const allDrops = relevantDrops.length > 0 ? relevantDrops : fallback;
  const pendingDrops = allDrops.filter((drop) => !isDropCompleted(drop));
  return { allDrops, pendingDrops };
}

async function inspectGameProgress(game: TwitchGame): Promise<{
  resolvedGame: TwitchGame;
  allDrops: TwitchDrop[];
  pendingDrops: TwitchDrop[];
}> {
  const initialGame = resolveGameFromState(game);
  const snapshot = await fetchDropsSnapshot(initialGame.name);
  if (snapshot?.games?.length) {
    appState.availableGames = mergeAvailableGames(appState.availableGames, snapshot.games);
    normalizeQueueSelection(appState.availableGames);
  }

  const resolvedGame = resolveGameFromState(initialGame);
  let candidateDrops = snapshot?.drops ?? [];
  const inventoryDrops = await fetchInventoryDrops(resolvedGame.name, resolvedGame.imageUrl);
  if (inventoryDrops.length > 0) {
    candidateDrops = mergeDropsWithInventory(candidateDrops, inventoryDrops);
  }
  if (candidateDrops.length === 0 && inventoryDrops.length > 0) {
    candidateDrops = inventoryDrops;
  }

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

  const suggestions = await fetchCategorySuggestions(game.name);
  if (suggestions.length > 0) {
    const ranked = suggestions
      .map((item) => ({ ...item, score: scoreCategoryMatch(game.name, item.slug, item.label) }))
      .sort((a, b) => b.score - a.score);
    return ranked[0].slug;
  }

  return toSlug(game.name);
}

async function openMutedChannel(channelName: string, viewerCount?: number) {
  const targetUrl = popoutPlayerUrl(channelName);
  const managedTabId = await ensureManagedTab(appState.tabId, targetUrl, true);
  if (!managedTabId) {
    return;
  }

  const prepareAudioWithRetry = async () => {
    await chrome.tabs.update(managedTabId, { active: true, muted: false }).catch(() => undefined);
    await waitForTabComplete(managedTabId, 15_000).catch(() => undefined);
    await ensureContentScriptOnTab(managedTabId);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const prepared: any = await chrome.tabs
        .sendMessage(managedTabId, {
          type: 'PREPARE_STREAM_PLAYBACK',
        })
        .catch(() => null);
      if (prepared?.isAudioReady) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 900));
      await chrome.tabs.update(managedTabId, { active: true, muted: false }).catch(() => undefined);
    }
  };

  void prepareAudioWithRetry().catch(() => undefined);
  appState.tabId = managedTabId;
  appState.activeStreamer = {
    id: channelName.toLowerCase(),
    name: channelName.toLowerCase(),
    displayName: channelName,
    isLive: true,
    viewerCount,
  };
  invalidStreamChecks = 0;
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

interface RefreshDropsOptions {
  includeCampaignFetch?: boolean;
  includeInventoryFetch?: boolean;
}

async function refreshDropsData(options: RefreshDropsOptions = {}) {
  const includeCampaignFetch = options.includeCampaignFetch ?? false;
  const includeInventoryFetch = options.includeInventoryFetch ?? appState.isRunning;
  const previousCompletedIds = new Set(appState.completedDrops.map((drop) => drop.id));
  let games = appState.availableGames;
  let drops = appState.allDrops;

  if (includeCampaignFetch) {
    const snapshot = await fetchDropsSnapshot();
    if (snapshot) {
      games = mergeAvailableGames(appState.availableGames, snapshot.games);
      drops = snapshot.drops;
    }
  }

  if (includeInventoryFetch && appState.selectedGame?.name) {
    const inventoryDrops = await fetchInventoryDrops(appState.selectedGame.name, appState.selectedGame.imageUrl);
    if (inventoryDrops.length > 0) {
      const baseDrops = drops.length > 0 ? drops : appState.allDrops;
      drops = mergeDropsWithInventory(baseDrops, inventoryDrops);
    }
  }

  if (drops.length === 0 && appState.allDrops.length > 0) {
    drops = appState.allDrops;
  }

  updateStateFromSnapshot({
    games,
    drops,
    updatedAt: Date.now(),
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
    return false;
  }

  const resolvedSlug = await resolveCategorySlug(appState.selectedGame);
  appState.selectedGame = {
    ...appState.selectedGame,
    categorySlug: resolvedSlug,
  };

  const streamers = await fetchDirectoryStreamers(resolvedSlug);
  const streamer = streamers.find((item) => item.viewerCount !== undefined && item.viewerCount < Number.MAX_SAFE_INTEGER) ?? streamers[0];
  if (streamer) {
    await openMutedChannel(streamer.displayName || streamer.name, streamer.viewerCount);
    return true;
  }

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

  await ensureInventoryTab();
  if (options.cleanupExternalTabs) {
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
  invalidStreamChecks = 0;
  lastStreamRotationAt = 0;
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

  const gameMatches = streamGameMatchesSelection(context, appState.selectedGame);
  const sameChannel = !appState.activeStreamer || context.channelName === appState.activeStreamer.name;
  const hasDropsSignal = context.titleContainsDrops || context.hasDropsSignal;
  const isValid = context.isLive && gameMatches && sameChannel && hasDropsSignal;
  if (isValid) {
    invalidStreamChecks = 0;
    return;
  }

  invalidStreamChecks += context.isLive && !hasDropsSignal ? 2 : context.isLive ? 1 : 2;
  if (invalidStreamChecks < INVALID_STREAM_THRESHOLD) {
    return;
  }

  const now = Date.now();
  if (now - lastStreamRotationAt < STREAM_ROTATE_COOLDOWN_MS) {
    return;
  }

  invalidStreamChecks = 0;
  lastStreamRotationAt = now;
  await chrome.tabs.remove(tab.id).catch(() => undefined);
  appState.tabId = null;
  appState.activeStreamer = null;
  await openBestStreamerForSelectedGame();

  await saveState();
}

async function handleStopFarming() {
  stopMonitoring();
  invalidStreamChecks = 0;
  lastStreamRotationAt = 0;
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
  appState.selectedGame = selectedGame;
  appState.completionNotified = false;
  if (appState.isRunning && !appState.isPaused) {
    removeGameFromQueue(selectedGame);
    appState.queue = [selectedGame, ...appState.queue];
  }
  if (appState.isRunning && !appState.isPaused) {
    await ensureWorkspaceForSelectedGame({ cleanupExternalTabs: true });
    await refreshDropsData({ includeCampaignFetch: true, includeInventoryFetch: true });
  } else {
    await refreshDropsData({ includeCampaignFetch: true, includeInventoryFetch: false });
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

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  switch (message.type) {
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

    case 'REFRESH_DROPS':
      refreshDropsData({ includeCampaignFetch: appState.isRunning, includeInventoryFetch: appState.isRunning })
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
