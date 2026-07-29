import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import { loadStoredAppState, subscribeToAppState } from '../shared/app-state-sync';
import { pickNearestDrop } from '../shared/drop-order';
import { getGameDisplayLabel } from '../shared/game-selection';
import {
  deriveRuntimeMode,
  formatFarmingCompleteStatusLines,
  formatRecoveryAttemptLabel,
  formatRecoveryReason,
  formatRetryLabel,
  formatStopReason,
} from '../shared/runtime-status';
import { createInitialState } from '../shared/utils';
import type { AppState } from '../types';

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

function recoveryLabel(reason: string | null | undefined): string | null {
  return formatRecoveryReason(reason);
}

function retryAtLabel(timestamp: number | null | undefined, now: number): string | null {
  return formatRetryLabel(timestamp, now);
}

function recoveryAttemptLabel(
  reason: string | null | undefined,
  attempts: number | null | undefined,
): string | null {
  return formatRecoveryAttemptLabel(reason, attempts);
}

export type MonitorViewProps = {
  readonly state: AppState;
  readonly lastUpdatedAt: number;
  readonly recoveryNow: number;
};

export function MonitorView({ state, lastUpdatedAt, recoveryNow }: MonitorViewProps) {
  const nearestDrop = useMemo(() => pickNearestDrop(state.pendingDrops), [state.pendingDrops]);
  const selectedCampaignLabel = state.selectedGame ? getGameDisplayLabel(state.selectedGame) : null;
  const runtimeMode = deriveRuntimeMode(state);
  const selectedRewardSummary = state.selectedGame?.rewardSummary;
  const statusLines =
    nearestDrop === null && selectedRewardSummary?.completion === 'farming-complete'
      ? formatFarmingCompleteStatusLines(selectedRewardSummary.remainderReasons)
      : [];
  const terminalStopLabel =
    statusLines.length > 0 ? formatStopReason('farming-complete') : formatStopReason(state.lastStopReason);
  const runStateClass =
    runtimeMode === 'recovering'
      ? 'monitor-pill monitor-pill--recovering'
      : runtimeMode === 'paused'
        ? 'monitor-pill monitor-pill--paused'
        : runtimeMode === 'running'
          ? 'monitor-pill monitor-pill--running'
          : runtimeMode === 'stopped-terminal'
            ? 'monitor-pill monitor-pill--stopped'
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
            <p className="monitor-subtitle">{selectedCampaignLabel ?? 'No campaign selected'}</p>
          </div>
          <span className={runStateClass}>{runStateLabel}</span>
        </div>

        <section className="monitor-body">
          {nearestDrop ? (
            <div className="monitor-drop">
              <p className="monitor-drop-name">{nearestDrop.name}</p>
              <div className="monitor-drop-meta">{nearestDrop.gameName}</div>
              <div className="monitor-progress-track">
                <div
                  className="monitor-progress-fill"
                  style={
                    {
                      '--dh-progress': Math.max(0, Math.min(100, nearestDrop.progress)) / 100,
                    } as CSSProperties
                  }
                />
              </div>
              <div className="monitor-progress-row">
                <span className="monitor-progress-left">{nearestDrop.progress}%</span>
                <span className="monitor-progress-right">{etaLabel(nearestDrop.remainingMinutes)}</span>
              </div>
            </div>
          ) : (
            <div className="monitor-empty">
              {statusLines.length > 0
                ? 'No automatable campaign rewards remain.'
                : 'No pending campaign rewards.'}
            </div>
          )}

          {statusLines.length > 0 && (
            <div className="monitor-reward-status" role="status" aria-live="polite" aria-atomic="true">
              {statusLines.map((line) => (
                <p className="monitor-reward-status-label" key={line}>
                  {line}
                </p>
              ))}
            </div>
          )}

          {runtimeMode === 'recovering' && state.recoveryReason && (
            <div className="monitor-rotation-reason">
              Recovering: {recoveryLabel(state.recoveryReason)}
              {recoveryAttemptLabel(state.recoveryReason, state.recoveryAttempts)
                ? ` · ${recoveryAttemptLabel(state.recoveryReason, state.recoveryAttempts)}`
                : ''}
              {retryAtLabel(state.recoveryBackoffUntil, recoveryNow)
                ? ` · ${retryAtLabel(state.recoveryBackoffUntil, recoveryNow)}`
                : ''}
            </div>
          )}

          {runtimeMode === 'stopped-terminal' && (state.lastStopMessage || terminalStopLabel) && (
            <div className="monitor-rotation-reason">
              Stopped: {terminalStopLabel ?? state.lastStopMessage}
            </div>
          )}
        </section>

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

function App() {
  const [state, setState] = useState<AppState>(createInitialState());
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number>(Date.now());
  const [recoveryNow, setRecoveryNow] = useState(Date.now());

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

  const runtimeMode = deriveRuntimeMode(state);
  useEffect(() => {
    if (runtimeMode !== 'recovering') {
      return;
    }
    setRecoveryNow(Date.now());
    const timer = window.setInterval(() => setRecoveryNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [runtimeMode]);

  return <MonitorView state={state} lastUpdatedAt={lastUpdatedAt} recoveryNow={recoveryNow} />;
}

export default App;
