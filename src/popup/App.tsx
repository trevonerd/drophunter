import { useEffect, useMemo, useState } from 'react';
import { AppState, ExpiryStatus, TwitchDrop, TwitchGame } from '../types';
import { sortPendingDrops } from '../shared/drop-order.js';

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

function isGameExpired(game: TwitchGame): boolean {
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
  const eta = formatEtaMinutes(drop.remainingMinutes);
  let statusText: string;
  let statusClass: string;

  if (drop.claimed) {
    statusText = 'Claimed';
    statusClass = 'text-green-400';
  } else if (drop.claimable) {
    statusText = 'Claim!';
    statusClass = 'text-yellow-300 font-bold';
  } else if (drop.status === 'active') {
    statusText = 'Active';
    statusClass = 'text-blue-300';
  } else {
    statusText = 'Pending';
    statusClass = 'text-gray-400';
  }

  return (
    <div className="flex items-center gap-2.5 px-3 py-2">
      <CompactDropImage drop={drop} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1">
          <p className="text-xs font-medium text-white truncate">{drop.name}</p>
          <span className="text-[11px] whitespace-nowrap shrink-0">
            <span className={statusClass}>{statusText}</span>
            <span className="text-gray-500"> · {drop.progress}%</span>
            {eta && !drop.claimed && !drop.claimable && <span className="text-gray-500"> · ETA {eta}</span>}
          </span>
        </div>
        <div className="mt-1 h-1 w-full rounded-full bg-gray-800 overflow-hidden">
          <div
            className={`h-1 rounded-full transition-all duration-500 ${
              drop.claimable
                ? 'bg-yellow-400'
                : 'bg-gradient-to-r from-twitch-purple to-pink-500'
            }`}
            style={{ width: `${drop.progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}

/* ── Main App ── */

function App() {
  const [state, setState] = useState<AppState>(createInitialState());
  const [loading, setLoading] = useState(true);
  const [gamesLoading, setGamesLoading] = useState(true);
  const [rewardsLoading, setRewardsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [queueMessage, setQueueMessage] = useState<string | null>(null);

  useEffect(() => {
    const loadState = async () => {
      try {
        const result = await chrome.storage.local.get(['appState']);
        if (result.appState) {
          setState({ ...createInitialState(), ...result.appState });
        }
      } catch (error) {
        console.error('Error loading state:', error);
      } finally {
        setLoading(false);
      }
      fetchAvailableGames().finally(() => setGamesLoading(false));
    };

    loadState();

    const listener = (message: { type?: string; payload?: AppState }) => {
      if (message.type === 'UPDATE_STATE' && message.payload) {
        setState({ ...createInitialState(), ...message.payload });
        setRewardsLoading(false);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const pendingDrops = useMemo(() => sortPendingDrops(state.pendingDrops), [state.pendingDrops]);
  const completedDrops = useMemo(() => state.completedDrops, [state.completedDrops]);
  const claimableCount = useMemo(() => state.pendingDrops.filter((d) => d.claimable).length, [state.pendingDrops]);
  const sortedGames = useMemo(
    () => [...state.availableGames].filter((g) => !isGameExpired(g)).sort((a, b) => a.name.localeCompare(b.name)),
    [state.availableGames]
  );
  const queueGames = useMemo(() => {
    const fallbackById = new Map(sortedGames.map((g) => [g.id, g]));
    return state.queue.map((q) => fallbackById.get(q.id) ?? q);
  }, [state.queue, sortedGames]);

  const fetchAvailableGames = async (force = false) => {
    await chrome.runtime.sendMessage({ type: 'ENSURE_GAMES_CACHE', payload: { force } }).catch(() => undefined);
    const latest = await chrome.storage.local.get(['appState']);
    if (latest.appState) {
      setState({ ...createInitialState(), ...latest.appState });
    }
  };

  const handleGameSelect = async (gameId: string) => {
    const selected = sortedGames.find((g) => g.id === gameId);
    if (selected) {
      setState((prev) => ({ ...prev, selectedGame: selected }));
      setQueueMessage(null);
      setRewardsLoading(true);
      try {
        await chrome.runtime.sendMessage({ type: 'SET_SELECTED_GAME', payload: { game: selected } }).catch(() => undefined);
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
        setQueueMessage(`Added "${state.selectedGame.name}" to queue.`);
        return;
      }
      if (response.reason === 'already-completed') {
        setQueueMessage(`"${state.selectedGame.name}" already has all rewards completed.`);
        return;
      }
      if (response.reason === 'already-queued') {
        setQueueMessage(`"${state.selectedGame.name}" is already in queue.`);
        return;
      }
      setQueueMessage(`"${state.selectedGame.name}" was not added to queue.`);
    } catch {
      setQueueMessage('Queue add failed.');
    } finally {
      setTimeout(() => setActionLoading(false), 250);
    }
  };

  const handleRemoveFromQueue = async (game: TwitchGame) => {
    await chrome.runtime.sendMessage({ type: 'REMOVE_FROM_QUEUE', payload: { game } }).catch(() => undefined);
  };

  const handleClearQueue = async () => {
    await chrome.runtime.sendMessage({ type: 'CLEAR_QUEUE' }).catch(() => undefined);
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
      await chrome.runtime.sendMessage({ type: 'START_FARMING', payload: { game: gameToStart } });
    });

  const handlePause = () => withAction(async () => {
    await chrome.runtime.sendMessage({ type: 'PAUSE_FARMING' });
  });

  const handleResume = () => withAction(async () => {
    await chrome.runtime.sendMessage({ type: 'RESUME_FARMING' });
  });

  const handleStop = () => withAction(async () => {
    await chrome.runtime.sendMessage({ type: 'STOP_FARMING' });
  });

  const openDropsPage = () => {
    chrome.tabs.create({ url: 'https://www.twitch.tv/drops/campaigns' });
  };

  const openMiniDashboard = async () => {
    await chrome.runtime.sendMessage({ type: 'OPEN_MONITOR_DASHBOARD' }).catch(() => undefined);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-300">
        <div className="spinner rounded-full h-8 w-8 border-3 border-twitch-purple border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-[#0E0E10] via-twitch-dark to-twitch-dark-light text-white">
      {/* ── Header ── */}
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
        </div>
      </div>

      {/* ── Body ── */}
      <div className="px-3 py-2.5 space-y-2.5">
        {/* Game selector + Queue button */}
        <div className="flex items-center gap-1.5">
          <select
            value={state.selectedGame?.id ?? ''}
            onChange={(e) => void handleGameSelect(e.target.value)}
            className="min-w-0 flex-1 glass-dark rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-twitch-purple"
            disabled={state.isRunning}
          >
            <option value="">Select a campaign...</option>
            {sortedGames.map((game) => (
              <option key={game.id} value={game.id}>
                {game.isConnected === false ? '\u{1F512} ' : ''}{game.name} · {expiryLabel(game.expiryStatus)}
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

        {/* Queue chips */}
        {queueGames.length > 0 && (
          <div className="flex flex-wrap gap-1 items-center">
            <span className="text-[11px] text-gray-500">Queue:</span>
            {queueGames.map((game, i) => (
              <span
                key={`${game.id}-${i}`}
                className="inline-flex items-center gap-0.5 rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-gray-200"
              >
                {game.name}
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
        {!state.isRunning && (
          <button
            onClick={handleStart}
            disabled={(!state.selectedGame && queueGames.length === 0) || actionLoading}
            className="w-full rounded-lg bg-green-600 py-2 text-sm font-semibold disabled:bg-gray-700 disabled:opacity-50 hover:bg-green-500 transition-colors"
          >
            {actionLoading ? 'Starting...' : queueGames.length > 0 ? `Start Queue (${queueGames.length})` : 'Start Farming'}
          </button>
        )}

        {/* Status line (only when running) */}
        {state.isRunning && (
          <p className="text-xs text-gray-300">
            {state.activeStreamer && (
              <>
                <span className="text-white font-medium">{state.activeStreamer.displayName}</span>
                <span className="text-gray-500"> · {state.activeStreamer.viewerCount?.toLocaleString() ?? '?'} viewers</span>
              </>
            )}
            {state.currentDrop && (
              <>
                {state.activeStreamer && <span className="text-gray-500"> · </span>}
                <span className="text-purple-300">{state.currentDrop.name} {state.currentDrop.progress}%</span>
                {formatEtaMinutes(state.currentDrop.remainingMinutes) && (
                  <span className="text-gray-500"> · ETA {formatEtaMinutes(state.currentDrop.remainingMinutes)}</span>
                )}
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
            <h3 className="text-xs font-semibold text-gray-200">Pending ({pendingDrops.length})</h3>
            {claimableCount > 0 && (
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
}

export default App;
