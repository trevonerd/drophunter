import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadStoredAppState, subscribeToAppState } from '../shared/app-state-sync';
import { sortPendingDrops } from '../shared/drop-order';
import { getGameDisplayLabel } from '../shared/game-selection';
import { deriveRuntimeMode, formatRecoveryReason, formatRetryLabel } from '../shared/runtime-status';
import { createInitialState, isExpiredGame } from '../shared/utils';
import { AppState, ExpiryStatus, StreamerSelectionMode, TwitchDrop, TwitchGame } from '../types';

const STREAMER_SELECTION_OPTIONS: Array<{ value: StreamerSelectionMode; label: string }> = [
  { value: 'low-view', label: 'Low view' },
  { value: 'random', label: 'Random' },
  { value: 'top-viewers', label: 'Top viewers' },
];

const STREAMER_LANGUAGE_OPTIONS = [
  { value: '', label: 'Any' },
  { value: 'en', label: 'EN' },
  { value: 'it', label: 'IT' },
  { value: 'es', label: 'ES' },
  { value: 'fr', label: 'FR' },
  { value: 'de', label: 'DE' },
  { value: 'pt', label: 'PT' },
  { value: 'ja', label: 'JA' },
  { value: 'ko', label: 'KO' },
];

function expiryLabel(status?: ExpiryStatus) {
  switch (status) {
    case 'urgent':
      return 'Expiry: < 24h';
    case 'warning':
      return 'Expiry: < 72h';
    case 'safe':
      return 'Expiry: not soon';
    default:
      return 'Expiry: unknown';
  }
}

function rewardInitials(name: string): string {
  const tokens = name
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) {
    return '?';
  }
  return tokens
    .slice(0, 2)
    .map((token) => token[0]?.toUpperCase() ?? '')
    .join('');
}

function formatEtaMinutes(value?: number | null): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  const minutes = Math.max(0, Math.round(value));
  if (minutes <= 0) {
    return '< 1m';
  }
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (hours === 0) {
    return `${rem}m`;
  }
  if (rem === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${rem}m`;
}

function statusReasonLabel(reason: string | null | undefined): string | null {
  return formatRecoveryReason(reason);
}

function retryLabel(timestamp?: number | null): string | null {
  return formatRetryLabel(timestamp);
}

/* ── SVG Icons ── */

function PauseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

function DropsIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 3s6 7 6 11a6 6 0 1 1-12 0c0-4 6-11 6-11z" />
    </svg>
  );
}

function MonitorIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2" y="3" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M8 21h8M12 17v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path
        d="M19.14 12.94c.04-.31.06-.62.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.18 7.18 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.58.22-1.13.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.62-.06.94s.02.63.06.94L2.83 14.52a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.4 1.05.72 1.63.94l.36 2.54a.5.5 0 0 0 .5.42h3.84a.5.5 0 0 0 .5-.42l.36-2.54c.58-.22 1.13-.54 1.63-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M15 6l-6 6 6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.167 6.839 9.49.5.092.682-.217.682-.482 0-.237-.009-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.607.069-.607 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
    </svg>
  );
}

function CoffeeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path
        d="M18 8h1a4 4 0 0 1 0 8h-1M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6 1v3M10 1v3M14 1v3"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SubIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20 6h-2.18c.11-.31.18-.65.18-1a3 3 0 0 0-3-3c-1.05 0-1.95.56-2.56 1.35L12 4.02l-.44-.67C10.95 2.56 10.05 2 9 2a3 3 0 0 0-3 3c0 .35.07.69.18 1H4c-1.11 0-1.99.89-1.99 2L2 19c0 1.1.89 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.11-.89-2-2-2zm-5-2c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zM9 4c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm11 15H4v-2h16v2zm0-5H4V8h5.08L7 10.83 8.62 12 12 7.4 15.38 12 17 10.83 14.92 8H20v6z" />
    </svg>
  );
}

/* ── Compact Drop Image (32x32) ── */

function CompactDropImage({ drop }: { drop: TwitchDrop }) {
  const [hasError, setHasError] = useState(false);
  if (!drop.imageUrl || hasError) {
    return (
      <div className="w-8 h-8 rounded border border-white/10 bg-gray-800/70 flex items-center justify-center text-[9px] font-bold text-gray-300 shrink-0">
        {rewardInitials(drop.name)}
      </div>
    );
  }
  return (
    <img
      src={drop.imageUrl}
      alt={drop.name}
      className="w-8 h-8 rounded object-cover bg-gray-900/60 shrink-0"
      referrerPolicy="no-referrer"
      onError={() => setHasError(true)}
    />
  );
}

/* ── Compact Drop Card ── */

function CompactDropCard({ drop }: { drop: TwitchDrop }) {
  const isEventBased = drop.dropType === 'event-based';
  const eta = formatEtaMinutes(drop.remainingMinutes);
  let statusText: string;
  let statusClass: string;

  if (drop.claimed) {
    statusText = 'Claimed';
    statusClass = 'text-green-400';
  } else if (drop.claimable) {
    statusText = 'Claim!';
    statusClass = 'text-yellow-300 font-bold';
  } else if (isEventBased) {
    statusText = 'Sub Only';
    statusClass = 'text-orange-400';
  } else if (drop.status === 'active') {
    statusText = 'Active';
    statusClass = 'text-blue-300';
  } else {
    statusText = 'Pending';
    statusClass = 'text-gray-400';
  }

  return (
    <div
      className={`flex items-center gap-2.5 px-3 py-2${isEventBased && !drop.claimed ? ' opacity-60' : ''}`}
    >
      <CompactDropImage drop={drop} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1">
          <p className="text-xs font-medium text-white truncate">
            {isEventBased && (
              <span className="text-orange-400 inline-flex align-middle mr-1">
                <SubIcon />
              </span>
            )}
            {drop.name}
          </p>
          <span className="text-[11px] whitespace-nowrap shrink-0">
            <span className={statusClass}>{statusText}</span>
            {!isEventBased && <span className="text-gray-500"> · {drop.progress}%</span>}
            {!isEventBased && eta && !drop.claimed && !drop.claimable && (
              <span className="text-gray-500"> · ETA {eta}</span>
            )}
          </span>
        </div>
        {isEventBased ? (
          <p className="mt-1 text-[10px] text-orange-400/70">Subscribe to redeem</p>
        ) : (
          <div className="mt-1 h-1 w-full rounded-full bg-gray-800 overflow-hidden">
            <div
              className={`h-1 rounded-full transition-all duration-500 ${
                drop.claimable ? 'bg-yellow-400' : 'bg-gradient-to-r from-twitch-purple to-pink-500'
              }`}
              style={{ width: `${drop.progress}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Main App ── */

function App() {
  const [state, setState] = useState<AppState>(createInitialState());
  const [loading, setLoading] = useState(true);
  const [gamesLoading, setGamesLoading] = useState(true);
  const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour
  const isStale =
    !state.isRunning &&
    !gamesLoading &&
    Date.now() - (state.lastSuccessfulRefreshAt ?? 0) > STALE_THRESHOLD_MS;
  const [rewardsLoading, setRewardsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [queueMessage, setQueueMessage] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'main' | 'settings'>('main');

  const fetchAvailableGames = useCallback(async (force = false) => {
    await chrome.runtime
      .sendMessage({ type: 'ENSURE_GAMES_CACHE', payload: { force } })
      .catch((err: unknown) => console.warn('[DropHunter] ENSURE_GAMES_CACHE failed:', err));
    setState(await loadStoredAppState());
  }, []);

  useEffect(() => {
    const loadState = async () => {
      try {
        setState(await loadStoredAppState());
      } catch (error) {
        console.error('Error loading state:', error);
      } finally {
        setLoading(false);
      }
      fetchAvailableGames().finally(() => setGamesLoading(false));
    };

    loadState();

    return subscribeToAppState((nextState) => {
      setState(nextState);
      setRewardsLoading(false);
    });
  }, [fetchAvailableGames]);

  const pendingDrops = useMemo(() => sortPendingDrops(state.pendingDrops), [state.pendingDrops]);
  const completedDrops = state.completedDrops;
  const claimableCount = useMemo(
    () => state.pendingDrops.filter((d) => d.claimable && d.dropType !== 'event-based').length,
    [state.pendingDrops],
  );
  const sortedGames = useMemo(
    () =>
      [...state.availableGames]
        .filter((g) => !isExpiredGame(g))
        .sort((a, b) => getGameDisplayLabel(a).localeCompare(getGameDisplayLabel(b))),
    [state.availableGames],
  );
  const queueGames = useMemo(() => {
    const fallbackById = new Map(sortedGames.map((g) => [g.id, g]));
    return state.queue.map((q) => fallbackById.get(q.id) ?? q);
  }, [state.queue, sortedGames]);
  const runtimeMode = deriveRuntimeMode(state);

  const handleGameSelect = async (gameId: string) => {
    const selected = sortedGames.find((g) => g.id === gameId);
    if (selected) {
      setState((prev) => ({ ...prev, selectedGame: selected }));
      setQueueMessage(null);
      setRewardsLoading(true);
      try {
        await chrome.runtime
          .sendMessage({ type: 'SET_SELECTED_GAME', payload: { game: selected } })
          .catch((err: unknown) => console.warn('[DropHunter] SET_SELECTED_GAME failed:', err));
      } finally {
        setTimeout(() => setRewardsLoading(false), 350);
      }
    }
  };

  const handleAddToQueue = async () => {
    if (!state.selectedGame || actionLoading) return;
    setActionLoading(true);
    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'ADD_TO_QUEUE',
        payload: { game: state.selectedGame },
      })) as { success?: boolean; added?: boolean; reason?: string };
      if (!response?.success) {
        setQueueMessage('Unable to add campaign to queue.');
        return;
      }
      if (response.added) {
        setQueueMessage(`Added "${getGameDisplayLabel(state.selectedGame)}" to queue.`);
        return;
      }
      if (response.reason === 'already-completed') {
        setQueueMessage(`"${getGameDisplayLabel(state.selectedGame)}" already has all rewards completed.`);
        return;
      }
      if (response.reason === 'already-queued') {
        setQueueMessage(`"${getGameDisplayLabel(state.selectedGame)}" is already in queue.`);
        return;
      }
      setQueueMessage(`"${getGameDisplayLabel(state.selectedGame)}" was not added to queue.`);
    } catch {
      setQueueMessage('Queue add failed.');
    } finally {
      setTimeout(() => setActionLoading(false), 250);
    }
  };

  const handleRemoveFromQueue = async (game: TwitchGame) => {
    await chrome.runtime
      .sendMessage({ type: 'REMOVE_FROM_QUEUE', payload: { game } })
      .catch((err: unknown) => console.warn('[DropHunter] REMOVE_FROM_QUEUE failed:', err));
  };

  const handleClearQueue = async () => {
    await chrome.runtime
      .sendMessage({ type: 'CLEAR_QUEUE' })
      .catch((err: unknown) => console.warn('[DropHunter] CLEAR_QUEUE failed:', err));
    setQueueMessage('Queue cleared.');
  };

  const withAction = async (action: () => Promise<void>) => {
    if (actionLoading) return;
    setActionLoading(true);
    try {
      await action();
    } finally {
      setTimeout(() => setActionLoading(false), 250);
    }
  };

  const handleStart = () =>
    withAction(async () => {
      const gameToStart = state.selectedGame ?? queueGames[0];
      if (!gameToStart) return;
      const response = (await chrome.runtime.sendMessage({
        type: 'START_FARMING',
        payload: { game: gameToStart },
      })) as { success?: boolean; error?: string } | undefined;
      if (response && !response.success && response.error) {
        setQueueMessage(response.error);
      }
    });

  const handlePause = () =>
    withAction(async () => {
      await chrome.runtime.sendMessage({ type: 'PAUSE_FARMING' });
    });

  const handleResume = () =>
    withAction(async () => {
      await chrome.runtime.sendMessage({ type: 'RESUME_FARMING' });
    });

  const handleStop = () =>
    withAction(async () => {
      await chrome.runtime.sendMessage({ type: 'STOP_FARMING' });
    });

  const openDropsPage = () => {
    chrome.tabs.create({ url: 'https://www.twitch.tv/drops/campaigns' });
  };

  const openMiniDashboard = async () => {
    await chrome.runtime
      .sendMessage({ type: 'OPEN_MONITOR_DASHBOARD', payload: { toggle: true } })
      .catch((err: unknown) => console.warn('[DropHunter] OPEN_MONITOR_DASHBOARD failed:', err));
  };

  const handleMonitorAutoOpenToggle = async () => {
    const next = !state.monitorAutoOpen;
    setState((prev) => ({ ...prev, monitorAutoOpen: next }));
    const response = (await chrome.runtime.sendMessage({
      type: 'SET_MONITOR_AUTO_OPEN',
      payload: { enabled: next },
    })) as { success?: boolean; monitorAutoOpen?: boolean } | undefined;
    if (!response?.success) {
      setState((prev) => ({ ...prev, monitorAutoOpen: !next }));
      return;
    }
    setState((prev) => ({ ...prev, monitorAutoOpen: response.monitorAutoOpen ?? next }));
  };

  const handleAutoClaimChannelPointsBonusToggle = async () => {
    const next = !state.autoClaimChannelPointsBonus;
    setState((prev) => ({ ...prev, autoClaimChannelPointsBonus: next }));
    const response = (await chrome.runtime.sendMessage({
      type: 'SET_AUTO_CLAIM_CHANNEL_POINTS_BONUS',
      payload: { enabled: next },
    })) as { success?: boolean; autoClaimChannelPointsBonus?: boolean } | undefined;
    if (!response?.success) {
      setState((prev) => ({ ...prev, autoClaimChannelPointsBonus: !next }));
      return;
    }
    setState((prev) => ({
      ...prev,
      autoClaimChannelPointsBonus: response.autoClaimChannelPointsBonus ?? next,
    }));
  };

  const handleMuteFarmingTabToggle = async () => {
    const next = !state.muteFarmingTab;
    setState((prev) => ({ ...prev, muteFarmingTab: next }));
    const response = (await chrome.runtime.sendMessage({
      type: 'SET_MUTE_FARMING_TAB',
      payload: { enabled: next },
    })) as { success?: boolean; muteFarmingTab?: boolean } | undefined;
    if (!response?.success) {
      setState((prev) => ({ ...prev, muteFarmingTab: !next }));
      return;
    }
    setState((prev) => ({
      ...prev,
      muteFarmingTab: response.muteFarmingTab ?? next,
    }));
  };

  const handleStreamerSelectionModeChange = async (mode: StreamerSelectionMode) => {
    const previous = state.streamerSelectionMode;
    setState((prev) => ({ ...prev, streamerSelectionMode: mode }));
    const response = (await chrome.runtime.sendMessage({
      type: 'SET_STREAMER_SELECTION_MODE',
      payload: { mode },
    })) as { success?: boolean; streamerSelectionMode?: StreamerSelectionMode } | undefined;
    if (!response?.success) {
      setState((prev) => ({ ...prev, streamerSelectionMode: previous }));
      return;
    }
    setState((prev) => ({
      ...prev,
      streamerSelectionMode: response.streamerSelectionMode ?? mode,
    }));
  };

  const handlePreferredStreamerLanguageChange = async (language: string) => {
    const next = language || null;
    const previous = state.preferredStreamerLanguage;
    setState((prev) => ({ ...prev, preferredStreamerLanguage: next }));
    const response = (await chrome.runtime.sendMessage({
      type: 'SET_PREFERRED_STREAMER_LANGUAGE',
      payload: { language: next },
    })) as { success?: boolean; preferredStreamerLanguage?: string | null } | undefined;
    if (!response?.success) {
      setState((prev) => ({ ...prev, preferredStreamerLanguage: previous ?? null }));
      return;
    }
    setState((prev) => ({
      ...prev,
      preferredStreamerLanguage: response.preferredStreamerLanguage ?? next,
    }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-300">
        <div className="spinner rounded-full h-8 w-8 border-[3px] border-twitch-purple border-t-transparent" />
      </div>
    );
  }

  const settingsView = (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-3 py-2.5 bg-gradient-to-r from-[#B286FF] via-[#A970FF] to-[#8F4CFF]">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveView('main')}
            className="rounded p-1 text-[#1B1030] hover:bg-white/20"
            title="Back"
          >
            <BackIcon />
          </button>
          <h1 className="font-extrabold text-sm tracking-tight text-[#120B22]">Settings</h1>
        </div>
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#24133D]/80">
          DropHunter
        </span>
      </div>

      <div className="px-4 py-3 space-y-2 bg-gradient-to-br from-[#0E0E10] via-twitch-dark to-twitch-dark-light">
        <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-white">Auto-open monitor</p>
              <p className="mt-1 text-[11px] text-gray-400">
                Open the Drop Hunter Monitor shortly after farming starts.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={state.monitorAutoOpen}
              onClick={() => void handleMonitorAutoOpenToggle()}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                state.monitorAutoOpen ? 'bg-green-500/90' : 'bg-white/15'
              }`}
            >
              <span
                className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                  state.monitorAutoOpen ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-white">Mute farming tab</p>
              <p className="mt-1 text-[11px] text-gray-400">
                Keep the Twitch tab used for farming muted. Disable this if you want to listen to the live
                stream.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={state.muteFarmingTab}
              onClick={() => void handleMuteFarmingTabToggle()}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                state.muteFarmingTab ? 'bg-green-500/90' : 'bg-white/15'
              }`}
            >
              <span
                className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                  state.muteFarmingTab ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-white">Auto-claim channel points bonus</p>
              <p className="mt-1 text-[11px] text-gray-400">
                Claim the free bonus points on the channel currently being farmed.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={state.autoClaimChannelPointsBonus}
              onClick={() => void handleAutoClaimChannelPointsBonusToggle()}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                state.autoClaimChannelPointsBonus ? 'bg-green-500/90' : 'bg-white/15'
              }`}
            >
              <span
                className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                  state.autoClaimChannelPointsBonus ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2.5">
          <p className="text-xs font-semibold text-white">Streamer selection</p>
          <p className="mt-1 text-[11px] text-gray-400">
            Prefer smaller channels, rotate randomly, or prioritize the biggest live channels.
          </p>
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {STREAMER_SELECTION_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => void handleStreamerSelectionModeChange(option.value)}
                className={`rounded-md border px-2 py-1.5 text-[11px] font-semibold transition-colors ${
                  state.streamerSelectionMode === option.value
                    ? 'border-purple-300/70 bg-purple-400/20 text-white'
                    : 'border-white/10 bg-black/20 text-gray-300 hover:border-white/20 hover:text-white'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-white">Preferred streamer language</p>
              <p className="mt-1 text-[11px] text-gray-400">
                If available, prefer streamers in this language. If none are live, DropHunter falls back
                automatically.
              </p>
            </div>
            <select
              value={state.preferredStreamerLanguage ?? ''}
              onChange={(event) => void handlePreferredStreamerLanguageChange(event.target.value)}
              className="min-w-[84px] rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-[11px] font-semibold text-white outline-none transition-colors hover:border-white/20"
            >
              {STREAMER_LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value || 'any'} value={option.value} className="bg-[#0E0E10] text-white">
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="pt-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-purple-300/80">About</p>
        </div>
        <p className="text-sm font-bold text-white">
          DropHunter{' '}
          <span className="text-purple-300 font-normal">v{chrome.runtime.getManifest().version}</span>
        </p>
        <p className="text-[11px] text-gray-400">
          by <span className="text-gray-200">Marco Trevisani</span> (trevonerd)
        </p>
        <p className="text-[11px] text-purple-300 font-semibold tracking-wide">TREVISOFT</p>
        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            onClick={() => chrome.tabs.create({ url: 'https://github.com/trevonerd/drophunter' })}
            className="flex items-center gap-1.5 text-[11px] text-gray-300 hover:text-white transition-colors"
          >
            <GitHubIcon />
            GitHub
          </button>
          <button
            type="button"
            onClick={() => chrome.tabs.create({ url: 'https://buymeacoffee.com/trevonerd' })}
            className="flex items-center gap-1.5 rounded-full bg-[#FFDD00]/90 hover:bg-[#FFDD00] px-2.5 py-1 text-[11px] font-semibold text-[#1a1a1a] transition-colors"
          >
            <CoffeeIcon />
            Buy Me a Coffee
          </button>
        </div>
      </div>
    </div>
  );

  const mainView = (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-3 py-2.5 bg-gradient-to-r from-[#B286FF] via-[#A970FF] to-[#8F4CFF]">
        <div className="flex items-center gap-2">
          <h1 className="font-extrabold text-sm tracking-tight text-[#120B22]">DropHunter</h1>
          {state.isRunning && (
            <span
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                state.isPaused
                  ? 'bg-yellow-400/20 text-yellow-200 border border-yellow-400/40'
                  : 'bg-green-400/20 text-green-200 border border-green-400/40'
              }`}
            >
              {state.isPaused ? 'PAUSED' : 'RUNNING'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {state.isRunning && (
            <>
              <button
                type="button"
                onClick={state.isPaused ? handleResume : handlePause}
                disabled={actionLoading}
                className="p-1 rounded hover:bg-white/20 text-[#1B1030] disabled:opacity-50"
                title={state.isPaused ? 'Resume' : 'Pause'}
              >
                {state.isPaused ? <PlayIcon /> : <PauseIcon />}
              </button>
              <button
                type="button"
                onClick={handleStop}
                disabled={actionLoading}
                className="p-1 rounded hover:bg-white/20 text-[#1B1030] disabled:opacity-50"
                title="Stop"
              >
                <StopIcon />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={openDropsPage}
            className="p-1 rounded hover:bg-white/20 text-[#1B1030]"
            title="Twitch Drops"
          >
            <DropsIcon />
          </button>
          <button
            type="button"
            onClick={openMiniDashboard}
            className="p-1 rounded hover:bg-white/20 text-[#1B1030]"
            title="Live Monitor"
          >
            <MonitorIcon />
          </button>
          <button
            type="button"
            onClick={() => setActiveView('settings')}
            className="p-1 rounded hover:bg-white/20 text-[#1B1030]"
            title="Settings"
          >
            <SettingsIcon />
          </button>
        </div>
      </div>

      <div className="px-3 py-2.5 space-y-2.5">
        {/* Game selector + Queue button */}
        <div className="flex items-center gap-1.5">
          <select
            value={state.selectedGame?.id ?? ''}
            onChange={(e) => void handleGameSelect(e.target.value)}
            className="min-w-0 flex-1 rounded-lg px-2 py-1.5 text-xs text-white bg-[#1F1F23] focus:outline-none focus:ring-1 focus:ring-twitch-purple [&>option]:bg-[#1F1F23] [&>option]:text-white"
            disabled={state.isRunning}
          >
            <option value="">Select a campaign...</option>
            {sortedGames.map((game) => (
              <option key={game.id} value={game.id}>
                {game.allDropsCompleted ? '\u2705 ' : game.isConnected === false ? '\u{1F512} ' : ''}
                {getGameDisplayLabel(game)} · {expiryLabel(game.expiryStatus)}
              </option>
            ))}
          </select>
          {!state.isRunning && (
            <button
              onClick={handleAddToQueue}
              disabled={!state.selectedGame || actionLoading}
              className="shrink-0 rounded-lg bg-blue-600 px-2 py-1.5 text-[11px] font-semibold disabled:opacity-50 disabled:bg-gray-700"
            >
              +Queue
            </button>
          )}
        </div>

        {queueMessage && <p className="text-[11px] text-blue-300">{queueMessage}</p>}

        {runtimeMode === 'recovering' && state.recoveryReason && (
          <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2">
            <p className="text-[11px] font-semibold text-yellow-300">
              {statusReasonLabel(state.recoveryReason)}
              {retryLabel(state.recoveryBackoffUntil) ? ` · ${retryLabel(state.recoveryBackoffUntil)}` : ''}
            </p>
          </div>
        )}

        {runtimeMode === 'stopped-terminal' && state.lastStopMessage && (
          <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
            <p className="text-[11px] text-gray-300">{state.lastStopMessage}</p>
          </div>
        )}

        {/* Queue chips */}
        {queueGames.length > 0 && (
          <div className="flex flex-wrap gap-1 items-center">
            <span className="text-[11px] text-gray-500">Queue:</span>
            {queueGames.map((game) => (
              <span
                key={game.campaignId ? `campaign:${game.campaignId}` : `id:${game.id}`}
                className="inline-flex items-center gap-0.5 rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-gray-200"
              >
                {game.allDropsCompleted ? '\u2705 ' : ''}
                {getGameDisplayLabel(game)}
                {!state.isRunning && (
                  <button
                    onClick={() => void handleRemoveFromQueue(game)}
                    className="ml-0.5 text-gray-400 hover:text-white"
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
            {!state.isRunning && (
              <button onClick={handleClearQueue} className="text-[11px] text-red-400 hover:text-red-300">
                Clear
              </button>
            )}
          </div>
        )}

        {/* Start button (only when not running) */}
        {!state.isRunning &&
          (() => {
            const selectedGameCompleted =
              (state.selectedGame?.allDropsCompleted ?? false) && queueGames.length === 0;
            const allQueuedCompleted =
              queueGames.length > 0 && queueGames.every((g) => g.allDropsCompleted ?? false);
            const allDropsClaimed = selectedGameCompleted || allQueuedCompleted;
            return (
              <>
                <button
                  onClick={handleStart}
                  disabled={
                    (!state.selectedGame && queueGames.length === 0) || actionLoading || allDropsClaimed
                  }
                  className="w-full rounded-lg bg-green-600 py-2 text-sm font-semibold disabled:bg-gray-700 disabled:opacity-50 hover:bg-green-500 transition-colors"
                >
                  {actionLoading
                    ? 'Starting...'
                    : queueGames.length > 0
                      ? `Start Queue (${queueGames.length})`
                      : 'Start Farming'}
                </button>
                {allDropsClaimed && (
                  <p className="text-center text-[11px] text-gray-400 mt-1">All rewards already claimed</p>
                )}
              </>
            );
          })()}

        {/* Status line (only when running) */}
        {state.isRunning && (
          <p className="text-xs text-gray-300">
            {state.activeStreamer && (
              <>
                <span className="text-white font-medium">{state.activeStreamer.displayName}</span>
                <span className="text-gray-500">
                  {' '}
                  · {state.activeStreamer.viewerCount?.toLocaleString() ?? '?'} viewers
                </span>
              </>
            )}
            {state.currentDrop && (
              <>
                {state.activeStreamer && <span className="text-gray-500"> · </span>}
                <span className="text-purple-300">
                  {state.currentDrop.name} {state.currentDrop.progress}%
                </span>
                {(() => {
                  const eta = formatEtaMinutes(state.currentDrop.remainingMinutes);
                  return eta ? <span className="text-gray-500"> · ETA {eta}</span> : null;
                })()}
              </>
            )}
            {!state.activeStreamer && !state.currentDrop && (
              <span className="text-gray-400">Searching for a streamer...</span>
            )}
          </p>
        )}

        {/* Pending drops */}
        <div className="glass rounded-lg border border-white/10">
          <div className="px-3 py-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-gray-200">
              Pending{!rewardsLoading && ` (${pendingDrops.length})`}
            </h3>
            {!rewardsLoading && claimableCount > 0 && (
              <span className="text-[11px] text-yellow-300 font-medium">{claimableCount} claimable</span>
            )}
          </div>
          {rewardsLoading ? (
            <div className="flex items-center gap-2 px-3 py-3">
              <div className="spinner h-4 w-4 rounded-full border-2 border-twitch-purple border-t-transparent" />
              <p className="text-xs text-gray-400">Loading...</p>
            </div>
          ) : pendingDrops.length > 0 ? (
            <div className="max-h-[240px] overflow-y-auto divide-y divide-white/5">
              {pendingDrops.map((drop) => (
                <CompactDropCard key={drop.id} drop={drop} />
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-500 px-3 py-3">No pending rewards.</p>
          )}
        </div>

        {/* Completed (inline summary) */}
        {completedDrops.length > 0 && (
          <p className="text-[11px] text-gray-500 px-1">
            <span className="font-semibold text-green-400">Completed ({completedDrops.length})</span>{' '}
            {completedDrops.map((d) => `\u2713 ${d.name}`).join('  ')}
          </p>
        )}

        {/* Stale data — refresh prompt */}
        {isStale && state.availableGames.length > 0 && (
          <div className="glass rounded-lg p-3 border border-yellow-500/30">
            <div className="space-y-2">
              <p className="text-xs text-yellow-300 font-semibold">Campaign data may be outdated</p>
              <p className="text-xs text-gray-400">
                Open the Twitch Drops page so the extension can fetch the latest campaigns.
              </p>
              <button
                type="button"
                onClick={openDropsPage}
                className="flex items-center gap-1.5 rounded-lg bg-twitch-purple/80 hover:bg-twitch-purple px-3 py-1.5 text-xs font-semibold text-white transition-colors"
              >
                <DropsIcon size={14} />
                Open Twitch Drops Page
              </button>
            </div>
          </div>
        )}

        {/* No campaigns — first-launch guidance */}
        {!state.isRunning && state.availableGames.length === 0 && (
          <div className="glass rounded-lg p-3 border border-blue-500/30">
            {gamesLoading ? (
              <div className="flex items-center gap-2">
                <div className="spinner h-4 w-4 rounded-full border-2 border-twitch-purple border-t-transparent" />
                <p className="text-xs text-blue-300">Loading campaigns...</p>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-blue-300 font-semibold">No campaigns detected</p>
                <p className="text-xs text-gray-400">
                  Open the Twitch Drops page first so the extension can detect available campaigns.
                </p>
                <button
                  type="button"
                  onClick={openDropsPage}
                  className="flex items-center gap-1.5 rounded-lg bg-twitch-purple/80 hover:bg-twitch-purple px-3 py-1.5 text-xs font-semibold text-white transition-colors"
                >
                  <DropsIcon size={14} />
                  Open Twitch Drops Page
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="w-[400px] bg-gradient-to-br from-[#0E0E10] via-twitch-dark to-twitch-dark-light text-white">
      {activeView === 'settings' ? settingsView : mainView}
    </div>
  );
}

export default App;
