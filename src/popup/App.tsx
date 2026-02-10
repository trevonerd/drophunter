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

function expiryClass(status?: ExpiryStatus) {
  switch (status) {
    case 'urgent':
      return 'border-red-500/40 text-red-300 bg-red-500/10';
    case 'warning':
      return 'border-orange-500/40 text-orange-300 bg-orange-500/10';
    case 'safe':
      return 'border-green-500/40 text-green-300 bg-green-500/10';
    default:
      return 'border-gray-500/30 text-gray-300 bg-gray-500/10';
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

function DropImage({ drop }: { drop: TwitchDrop }) {
  const [hasError, setHasError] = useState(false);
  if (!drop.imageUrl || hasError) {
    return (
      <div className="w-12 h-12 rounded-lg border border-white/10 bg-gray-800/70 flex items-center justify-center text-[10px] font-bold text-gray-300">
        {rewardInitials(drop.name)}
      </div>
    );
  }

  return (
    <img
      src={drop.imageUrl}
      alt={drop.name}
      className="w-12 h-12 rounded-lg object-cover bg-gray-900/60"
      referrerPolicy="no-referrer"
      onError={() => setHasError(true)}
    />
  );
}

function renderDropCard(drop: TwitchDrop) {
  const statusLabel = drop.claimed ? 'Claimed' : drop.claimable ? 'Claim now' : 'In progress';
  const statusClass = drop.claimed
    ? 'bg-green-500/15 text-green-300 border-green-500/30'
    : drop.claimable
      ? 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30'
      : 'bg-blue-500/15 text-blue-300 border-blue-500/30';

  return (
    <div key={drop.id} className="glass-dark rounded-xl p-3 border border-white/10">
      <div className="flex gap-3">
        <DropImage drop={drop} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-white truncate">{drop.name}</p>
            <span className={`text-[10px] px-2 py-0.5 rounded-full border whitespace-nowrap ${statusClass}`}>{statusLabel}</span>
          </div>
          <p className="text-xs text-gray-400 truncate">{drop.gameName}</p>
          <div className="mt-2 h-2 w-full rounded-full bg-gray-800 overflow-hidden">
            <div
              className="h-2 rounded-full bg-gradient-to-r from-twitch-purple to-pink-500 transition-all duration-500"
              style={{ width: `${drop.progress}%` }}
            />
          </div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <p className="text-xs text-gray-300">{drop.progress}%</p>
            {formatEtaMinutes(drop.remainingMinutes) && !drop.claimed && !drop.claimable && (
              <p className="text-[11px] text-gray-400">ETA {formatEtaMinutes(drop.remainingMinutes)}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DashboardIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 13h6v7H4zM14 4h6v16h-6zM4 4h6v7H4z" fill="currentColor" />
    </svg>
  );
}

function InventoryIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 9h18v11H3zM5 9l2-4h10l2 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DropsIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3s6 7 6 11a6 6 0 1 1-12 0c0-4 6-11 6-11z" fill="currentColor" />
    </svg>
  );
}

function App() {
  const [state, setState] = useState<AppState>(createInitialState());
  const [loading, setLoading] = useState(true);
  const [rewardsLoading, setRewardsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [queueMessage, setQueueMessage] = useState<string | null>(null);
  const [pendingPage, setPendingPage] = useState(0);
  const [completedPage, setCompletedPage] = useState(0);

  useEffect(() => {
    const loadState = async () => {
      let hasCachedGames = false;
      try {
        const result = await chrome.storage.local.get(['appState']);
        if (result.appState) {
          setState({ ...createInitialState(), ...result.appState });
          hasCachedGames = Array.isArray(result.appState.availableGames) && result.appState.availableGames.length > 0;
        }
        if (hasCachedGames) {
          void fetchAvailableGames();
        } else {
          await fetchAvailableGames();
        }
      } catch (error) {
        console.error('Error loading state:', error);
      } finally {
        setLoading(false);
      }
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

  useEffect(() => {
    setPendingPage(0);
  }, [state.selectedGame?.id, state.pendingDrops.length]);

  useEffect(() => {
    setCompletedPage(0);
  }, [state.selectedGame?.id, state.completedDrops.length]);

  const pendingDrops = useMemo(() => {
    return sortPendingDrops(state.pendingDrops);
  }, [state.pendingDrops]);
  const completedDrops = useMemo(() => state.completedDrops, [state.completedDrops]);
  const claimableCount = useMemo(() => state.pendingDrops.filter((drop) => drop.claimable).length, [state.pendingDrops]);
  const sortedGames = useMemo(
    () => [...state.availableGames].filter((game) => !isGameExpired(game)).sort((a, b) => a.name.localeCompare(b.name)),
    [state.availableGames]
  );
  const queueGames = useMemo(() => {
    const fallbackById = new Map(sortedGames.map((game) => [game.id, game]));
    return state.queue.map((queued) => fallbackById.get(queued.id) ?? queued);
  }, [state.queue, sortedGames]);

  const visiblePendingDrops = useMemo(() => {
    const start = pendingPage * 3;
    return pendingDrops.slice(start, start + 3);
  }, [pendingDrops, pendingPage]);

  const visibleCompletedDrops = useMemo(() => {
    const start = completedPage * 3;
    return completedDrops.slice(start, start + 3);
  }, [completedDrops, completedPage]);

  const pendingPages = Math.max(1, Math.ceil(pendingDrops.length / 3));
  const completedPages = Math.max(1, Math.ceil(completedDrops.length / 3));

  const fetchAvailableGames = async (force = false) => {
    await chrome.runtime
      .sendMessage({
        type: 'ENSURE_GAMES_CACHE',
        payload: { force },
      })
      .catch(() => undefined);
    const latest = await chrome.storage.local.get(['appState']);
    if (latest.appState) {
      setState({ ...createInitialState(), ...latest.appState });
    }
  };

  const handleGameSelect = async (gameId: string) => {
    const selected = sortedGames.find((game) => game.id === gameId);
    if (selected) {
      setState((prev) => ({ ...prev, selectedGame: selected }));
      setQueueMessage(null);
      setRewardsLoading(true);
      try {
        await chrome.runtime
          .sendMessage({
            type: 'SET_SELECTED_GAME',
            payload: { game: selected },
          })
          .catch(() => undefined);
      } finally {
        setTimeout(() => setRewardsLoading(false), 350);
      }
    }
  };

  const handleAddToQueue = async () => {
    if (!state.selectedGame || actionLoading) {
      return;
    }
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
    } catch (error) {
      console.error('Unable to add queue item:', error);
      setQueueMessage('Queue add failed.');
    } finally {
      setTimeout(() => setActionLoading(false), 250);
    }
  };

  const handleRemoveFromQueue = async (game: TwitchGame) => {
    await chrome.runtime
      .sendMessage({
        type: 'REMOVE_FROM_QUEUE',
        payload: { game },
      })
      .catch(() => undefined);
  };

  const handleClearQueue = async () => {
    await chrome.runtime.sendMessage({ type: 'CLEAR_QUEUE' }).catch(() => undefined);
    setQueueMessage('Queue cleared.');
  };

  const withAction = async (action: () => Promise<void>) => {
    if (actionLoading) {
      return;
    }
    setActionLoading(true);
    try {
      await action();
    } finally {
      setTimeout(() => setActionLoading(false), 250);
    }
  };

  const handleStart = async () =>
    withAction(async () => {
      const gameToStart = state.selectedGame ?? queueGames[0];
      if (!gameToStart) {
        return;
      }
      await chrome.runtime.sendMessage({
        type: 'START_FARMING',
        payload: { game: gameToStart },
      });
    });

  const handlePause = async () =>
    withAction(async () => {
      await chrome.runtime.sendMessage({ type: 'PAUSE_FARMING' });
    });

  const handleResume = async () =>
    withAction(async () => {
      await chrome.runtime.sendMessage({ type: 'RESUME_FARMING' });
    });

  const handleStop = async () =>
    withAction(async () => {
      await chrome.runtime.sendMessage({ type: 'STOP_FARMING' });
    });

  const openDropsPage = () => {
    chrome.tabs.create({ url: 'https://www.twitch.tv/drops/campaigns' });
  };

  const openInventoryPage = () => {
    chrome.tabs.create({ url: 'https://www.twitch.tv/drops/inventory' });
  };

  const openMiniDashboard = async () => {
    await chrome.runtime.sendMessage({ type: 'OPEN_MONITOR_DASHBOARD' }).catch(() => undefined);
  };

  if (loading) {
    return (
      <div className="flex min-h-[500px] items-center justify-center text-gray-300">
        <div className="spinner rounded-full h-10 w-10 border-4 border-twitch-purple border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="min-h-[500px] bg-gradient-to-br from-[#0E0E10] via-twitch-dark to-twitch-dark-light text-white">
      <div className="relative bg-gradient-to-r from-[#B286FF] via-[#A970FF] to-[#8F4CFF] p-4 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="font-extrabold text-lg tracking-tight text-[#120B22]">DropHunter Control</h1>
            <p className="text-xs text-[#2D1A4D]">Twitch Drops Command Center</p>
          </div>
          <div className="flex min-w-[126px] flex-col items-stretch gap-1.5">
            <button
              type="button"
              onClick={openDropsPage}
              className="glass flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold text-[#1B1030] hover:bg-white/20"
            >
              <DropsIcon />
              Drops
            </button>
            <button
              type="button"
              onClick={openInventoryPage}
              className="glass flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold text-[#1B1030] hover:bg-white/20"
            >
              <InventoryIcon />
              Inventory
            </button>
            <button
              type="button"
              onClick={openMiniDashboard}
              className="glass flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold text-[#1B1030] hover:bg-white/20"
            >
              <DashboardIcon />
              Dashboard
            </button>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        <div>
          <label className="block text-sm font-semibold mb-2 text-gray-200">Game Campaign</label>
          <select
            value={state.selectedGame?.id ?? ''}
            onChange={(event) => {
              void handleGameSelect(event.target.value);
            }}
            className="w-full glass-dark rounded-xl px-3 py-3 text-white focus:outline-none focus:ring-2 focus:ring-twitch-purple"
            disabled={state.isRunning}
          >
            <option value="">Select a campaign...</option>
            {sortedGames.map((game) => (
              <option key={game.id} value={game.id}>
                {game.name} · {expiryLabel(game.expiryStatus)}
              </option>
            ))}
          </select>
          <div className="mt-2 flex items-center gap-2">
            {claimableCount > 0 && <span className="text-xs text-yellow-300">{claimableCount} reward(s) ready to claim</span>}
          </div>
        </div>

        {!state.isRunning && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleAddToQueue}
              disabled={!state.selectedGame || actionLoading}
              className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold disabled:opacity-50 disabled:bg-gray-700"
            >
              {actionLoading ? 'Adding...' : 'Add to Queue'}
            </button>
            <span className="text-xs text-gray-400">Queue: {queueGames.length}</span>
          </div>
        )}

        {queueMessage && <p className="text-xs text-blue-300">{queueMessage}</p>}

        {queueGames.length > 0 && (
          <div className="glass-dark rounded-xl border border-white/10 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-200">Queue Order</p>
              <button onClick={handleClearQueue} className="text-xs text-red-300 hover:text-red-200">
                Clear
              </button>
            </div>
            <div className="space-y-1 max-h-28 overflow-auto pr-1">
              {queueGames.map((game, index) => (
                <div key={`${game.id}-${index}`} className="flex items-center justify-between gap-2 rounded-md bg-black/20 px-2 py-1">
                  <p className="text-xs text-gray-200 truncate">
                    {index + 1}. {game.name}
                  </p>
                  <button
                    onClick={() => {
                      void handleRemoveFromQueue(game);
                    }}
                    className="text-[11px] text-gray-400 hover:text-white"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-2">
          {!state.isRunning ? (
            <button
              onClick={handleStart}
              disabled={(!state.selectedGame && queueGames.length === 0) || actionLoading}
              className="flex-1 rounded-lg bg-green-600 py-2.5 text-sm font-semibold disabled:bg-gray-700 disabled:opacity-50"
            >
              {actionLoading ? 'Starting...' : queueGames.length > 0 ? `Start Queue (${queueGames.length})` : 'Start'}
            </button>
          ) : (
            <>
              <button
                onClick={state.isPaused ? handleResume : handlePause}
                disabled={actionLoading}
                className="flex-1 rounded-lg bg-yellow-600 py-2 text-sm font-semibold disabled:opacity-50"
              >
                {state.isPaused ? 'Resume' : 'Pause'}
              </button>
              <button
                onClick={handleStop}
                disabled={actionLoading}
                className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-semibold disabled:opacity-50"
              >
                Stop
              </button>
            </>
          )}
        </div>

        {state.isRunning && (
          <div className="glass rounded-xl p-4 border border-white/10">
            <p className="text-sm text-gray-300">Status</p>
            <p className="text-base font-semibold">{state.isPaused ? 'Paused' : 'Running'}</p>
            {state.activeStreamer && (
              <p className="text-xs text-gray-400 mt-1">
                Streamer: {state.activeStreamer.displayName} ({state.activeStreamer.viewerCount?.toLocaleString() ?? 'n/a'} viewers)
              </p>
            )}
            {state.currentDrop && (
              <p className="text-xs text-purple-300 mt-1">
                Current: {state.currentDrop.name} ({state.currentDrop.progress}%)
                {formatEtaMinutes(state.currentDrop.remainingMinutes) ? ` · ETA ${formatEtaMinutes(state.currentDrop.remainingMinutes)}` : ''}
              </p>
            )}
          </div>
        )}

        <div className="glass rounded-xl p-4 border border-white/10 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-200">Pending Rewards ({pendingDrops.length})</h3>
            <div className="flex items-center gap-2">
              <button
                className="rounded-md border border-white/20 px-2 py-1 text-xs disabled:opacity-40"
                disabled={pendingPage === 0}
                onClick={() => setPendingPage((prev) => Math.max(0, prev - 1))}
              >
                Prev
              </button>
              <span className="text-xs text-gray-400">
                {pendingPage + 1}/{pendingPages}
              </span>
              <button
                className="rounded-md border border-white/20 px-2 py-1 text-xs disabled:opacity-40"
                disabled={pendingPage >= pendingPages - 1}
                onClick={() => setPendingPage((prev) => Math.min(pendingPages - 1, prev + 1))}
              >
                Next
              </button>
            </div>
          </div>
          {rewardsLoading ? (
            <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-3">
              <div className="spinner h-4 w-4 rounded-full border-2 border-twitch-purple border-t-transparent" />
              <p className="text-xs text-gray-300">Loading pending rewards...</p>
            </div>
          ) : visiblePendingDrops.length > 0 ? (
            <div className="space-y-2">{visiblePendingDrops.map(renderDropCard)}</div>
          ) : (
            <p className="text-xs text-gray-400">No pending rewards for the selected campaign.</p>
          )}
        </div>

        <div className="glass rounded-xl p-4 border border-green-500/20 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-green-300">Completed Rewards ({completedDrops.length})</h3>
            <div className="flex items-center gap-2">
              <button
                className="rounded-md border border-white/20 px-2 py-1 text-xs disabled:opacity-40"
                disabled={completedPage === 0}
                onClick={() => setCompletedPage((prev) => Math.max(0, prev - 1))}
              >
                Prev
              </button>
              <span className="text-xs text-gray-400">
                {completedPage + 1}/{completedPages}
              </span>
              <button
                className="rounded-md border border-white/20 px-2 py-1 text-xs disabled:opacity-40"
                disabled={completedPage >= completedPages - 1}
                onClick={() => setCompletedPage((prev) => Math.min(completedPages - 1, prev + 1))}
              >
                Next
              </button>
            </div>
          </div>
          {rewardsLoading ? (
            <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-3">
              <div className="spinner h-4 w-4 rounded-full border-2 border-twitch-purple border-t-transparent" />
              <p className="text-xs text-gray-300">Loading completed rewards...</p>
            </div>
          ) : visibleCompletedDrops.length > 0 ? (
            <div className="space-y-2">{visibleCompletedDrops.map(renderDropCard)}</div>
          ) : (
            <p className="text-xs text-gray-400">Completed rewards will remain visible here.</p>
          )}
        </div>

        {!state.isRunning && state.availableGames.length === 0 && (
          <div className="glass rounded-xl p-4 border border-blue-500/30">
            <p className="text-sm text-blue-300 font-semibold">No campaigns detected</p>
            <p className="text-xs text-gray-300 mt-1">Open Twitch Drops campaigns page first, then refresh this popup.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
