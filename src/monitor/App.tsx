import { useEffect, useMemo, useState } from 'react';
import { loadStoredAppState, subscribeToAppState } from '../shared/app-state-sync';
import { pickNearestDrop } from '../shared/drop-order';
import {
  deriveRuntimeMode,
  formatRecoveryReason,
  formatRetryLabel,
  formatRotationReason,
} from '../shared/runtime-status';
import { createInitialState } from '../shared/utils';
import { AppState } from '../types';

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

function rotationReasonLabel(reason: string | null | undefined): string | null {
  return formatRotationReason(reason);
}

function recoveryLabel(reason: string | null | undefined): string | null {
  return formatRecoveryReason(reason);
}

function retryAtLabel(timestamp?: number | null): string | null {
  return formatRetryLabel(timestamp);
}

function App() {
  const [state, setState] = useState<AppState>(createInitialState());
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number>(Date.now());

  useEffect(() => {
    const syncState = async () => {
      setState(await loadStoredAppState());
      setLastUpdatedAt(Date.now());
    };

    syncState().catch(() => undefined);
    const unsubscribe = subscribeToAppState((nextState) => {
      setState(nextState);
      setLastUpdatedAt(Date.now());
    });

    return unsubscribe;
  }, []);

  const nearestDrop = useMemo(() => pickNearestDrop(state.pendingDrops), [state.pendingDrops]);
  const runtimeMode = deriveRuntimeMode(state);
  const runStateClass =
    runtimeMode === 'recovering'
      ? 'monitor-pill monitor-pill--recovering'
      : runtimeMode === 'paused'
        ? 'monitor-pill monitor-pill--paused'
        : runtimeMode === 'running'
          ? 'monitor-pill monitor-pill--running'
          : 'monitor-pill monitor-pill--idle';
  const runStateLabel =
    runtimeMode === 'recovering'
      ? 'RECOVERING'
      : runtimeMode === 'paused'
        ? 'PAUSED'
        : runtimeMode === 'running'
          ? 'RUNNING'
          : runtimeMode === 'stopped-terminal'
            ? 'STOPPED'
            : 'IDLE';

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
              <div
                className="monitor-progress-fill"
                style={{ width: `${Math.max(0, Math.min(100, nearestDrop.progress))}%` }}
              />
            </div>
            <div className="monitor-progress-row">
              <span className="monitor-progress-left">{nearestDrop.progress}%</span>
              <span className="monitor-progress-right">{etaLabel(nearestDrop.remainingMinutes)}</span>
            </div>
          </div>
        ) : (
          <div className="monitor-empty">No pending rewards for the selected campaign.</div>
        )}

        {(runtimeMode === 'running' || runtimeMode === 'recovering') && state.lastRotationReason && (
          <div className="monitor-rotation-reason">
            ↻ {rotationReasonLabel(state.lastRotationReason) ?? state.lastRotationReason}
          </div>
        )}

        {runtimeMode === 'recovering' && state.recoveryReason && (
          <div className="monitor-rotation-reason">
            Recovering: {recoveryLabel(state.recoveryReason)}
            {retryAtLabel(state.recoveryBackoffUntil) ? ` · ${retryAtLabel(state.recoveryBackoffUntil)}` : ''}
          </div>
        )}

        {runtimeMode === 'stopped-terminal' && state.lastStopMessage && (
          <div className="monitor-rotation-reason">Stopped: {state.lastStopMessage}</div>
        )}

        <div className="monitor-footer">
          <span className="monitor-channel">
            {state.activeStreamer ? `/${state.activeStreamer.displayName}` : 'No active streamer'}
          </span>
          <span className="monitor-updated">Updated {updatedLabel(lastUpdatedAt)}</span>
        </div>
      </div>
    </div>
  );
}

export default App;
