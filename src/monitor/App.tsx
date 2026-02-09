import { useEffect, useMemo, useState } from 'react';
import { AppState } from '../types';
import { pickNearestDrop } from '../shared/drop-order.js';

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

function etaLabel(value?: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'ETA n/a';
  }
  const minutes = Math.max(0, Math.round(value));
  if (minutes <= 0) {
    return 'ETA < 1m';
  }
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (hours === 0) {
    return `ETA ${rem}m`;
  }
  if (rem === 0) {
    return `ETA ${hours}h`;
  }
  return `ETA ${hours}h ${rem}m`;
}

function updatedLabel(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.toLocaleTimeString()}`;
}

function App() {
  const [state, setState] = useState<AppState>(createInitialState());
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number>(Date.now());

  useEffect(() => {
    const syncState = async () => {
      const result = await chrome.storage.local.get(['appState']);
      if (result.appState) {
        setState({ ...createInitialState(), ...result.appState });
        setLastUpdatedAt(Date.now());
      }
    };

    syncState().catch(() => undefined);
    const timer = window.setInterval(() => {
      syncState().catch(() => undefined);
    }, 4000);

    const listener = (message: { type?: string; payload?: AppState }) => {
      if (message.type === 'UPDATE_STATE' && message.payload) {
        setState({ ...createInitialState(), ...message.payload });
        setLastUpdatedAt(Date.now());
      }
    };
    chrome.runtime.onMessage.addListener(listener);

    return () => {
      window.clearInterval(timer);
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, []);

  const nearestDrop = useMemo(() => pickNearestDrop(state.pendingDrops), [state.pendingDrops]);

  const runStateClass = state.isRunning ? (state.isPaused ? 'monitor-pill monitor-pill--paused' : 'monitor-pill monitor-pill--running') : 'monitor-pill monitor-pill--idle';
  const runStateLabel = state.isRunning ? (state.isPaused ? 'PAUSED' : 'RUNNING') : 'IDLE';

  return (
    <div className="monitor-shell">
      <div className="monitor-card">
        <div className="monitor-header">
          <div>
            <h1 className="monitor-title">DropHunter Live</h1>
            <p className="monitor-subtitle">{state.selectedGame?.name ?? 'No campaign selected'}</p>
          </div>
          <span className={runStateClass}>{runStateLabel}</span>
        </div>

        {nearestDrop ? (
          <div className="monitor-drop">
            <p className="monitor-drop-name">{nearestDrop.name}</p>
            <div className="monitor-drop-meta">{nearestDrop.gameName}</div>
            <div className="monitor-progress-track">
              <div className="monitor-progress-fill" style={{ width: `${Math.max(0, Math.min(100, nearestDrop.progress))}%` }} />
            </div>
            <div className="monitor-progress-row">
              <span className="monitor-progress-left">{nearestDrop.progress}%</span>
              <span className="monitor-progress-right">{etaLabel(nearestDrop.remainingMinutes)}</span>
            </div>
          </div>
        ) : (
          <div className="monitor-empty">Nessun reward pending per la campagna selezionata.</div>
        )}

        <div className="monitor-footer">
          <span className="monitor-channel">
            {state.activeStreamer ? `/${state.activeStreamer.displayName}` : 'Streamer non attivo'}
          </span>
          <span className="monitor-updated">Updated {updatedLabel(lastUpdatedAt)}</span>
        </div>
      </div>
    </div>
  );
}

export default App;
