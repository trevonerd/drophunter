import { type CSSProperties, useEffect, useState } from 'react';
import { loadStoredAppState, subscribeToAppState } from '../shared/app-state-sync';
import {
  deriveRuntimeMode,
  formatEtaMinutes,
  formatFarmingCompleteStatusLines,
} from '../shared/runtime-status';
import { createUserStatusModel, type UserStatusMode } from '../shared/user-status';
import { createInitialState } from '../shared/utils';
import type { AppState, AutomationActivityEntry } from '../types';
import { selectMonitorDrop } from './selected-drop';

const AUTOMATION_NOTICE_TTL_MS = 6_000;

function etaLabel(value?: number | null): string {
  return `ETA ${formatEtaMinutes(value) ?? 'n/a'}`;
}

function updatedLabel(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.toLocaleTimeString()}`;
}

function getRecentAutomationActivity(activities: readonly AutomationActivityEntry[], now: number) {
  let newestActivity: AutomationActivityEntry | null = null;
  for (const entry of activities) {
    const isFresh = entry.at <= now && now - entry.at < AUTOMATION_NOTICE_TTL_MS;
    if (isFresh && (newestActivity === null || entry.at > newestActivity.at)) {
      newestActivity = entry;
    }
  }
  return newestActivity;
}

const monitorPillClasses: Record<UserStatusMode, string> = {
  ready: 'monitor-pill monitor-pill--idle',
  'pending-validation': 'monitor-pill monitor-pill--paused',
  running: 'monitor-pill monitor-pill--running',
  paused: 'monitor-pill monitor-pill--paused',
  recovering: 'monitor-pill monitor-pill--recovering',
  stopped: 'monitor-pill monitor-pill--stopped',
  complete: 'monitor-pill monitor-pill--running',
  'attention-required': 'monitor-pill monitor-pill--stopped',
};

export type MonitorViewProps = {
  readonly state: AppState;
  readonly lastUpdatedAt: number;
  readonly recoveryNow: number;
  readonly contextNow: number;
};

export function MonitorView({ state, lastUpdatedAt, recoveryNow, contextNow }: MonitorViewProps) {
  const nearestDrop = selectMonitorDrop(state);
  const runtimeMode = deriveRuntimeMode(state);
  const status = createUserStatusModel({
    state,
    runtimeMode,
    currentAutomatableDrop: nearestDrop,
    recoveryNow,
  });
  const selectedRewardSummary = state.selectedGame?.rewardSummary;
  const statusLines =
    nearestDrop === null && selectedRewardSummary?.completion === 'farming-complete'
      ? formatFarmingCompleteStatusLines(selectedRewardSummary.remainderReasons)
      : [];
  const runStateClass = monitorPillClasses[status.mode];
  const recentAutomationMessage =
    state.autoStartFavoriteGames && state.twitchSessionDetected
      ? (getRecentAutomationActivity(state.automationActivity, contextNow)?.message ?? null)
      : null;
  const hasPrimaryNotice =
    status.mode === 'recovering' ||
    status.mode === 'attention-required' ||
    (status.mode === 'complete' && statusLines.length === 0) ||
    status.mode === 'pending-validation' ||
    status.label === 'Manual viewing';
  const contextNotice = hasPrimaryNotice && status.detail ? status.detail : recentAutomationMessage;
  const contextNoticeClass =
    status.mode === 'recovering' ||
    status.mode === 'attention-required' ||
    status.mode === 'pending-validation'
      ? 'monitor-context-notice monitor-context-notice--warning'
      : 'monitor-context-notice';
  const announceContextNotice = status.mode !== 'recovering';
  return (
    <main className="monitor-shell">
      <div className="monitor-card">
        <div className="monitor-header">
          <div>
            <h1 className="monitor-title">DropHunter Live</h1>
            <p className="monitor-subtitle">{status.subject}</p>
          </div>
          <span className={runStateClass} role="status" aria-live="polite" aria-atomic="true">
            {status.badge}
          </span>
        </div>

        <section className="monitor-body">
          {nearestDrop ? (
            <div className="monitor-drop">
              <p className="monitor-drop-name">{nearestDrop.name}</p>
              <div className="monitor-drop-meta">{nearestDrop.gameName}</div>
              <div
                className="monitor-progress-track"
                role="progressbar"
                aria-label={`${nearestDrop.name} progress`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.max(0, Math.min(100, nearestDrop.progress))}
              >
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

          {contextNotice && (
            <div
              className={contextNoticeClass}
              role={announceContextNotice ? 'status' : undefined}
              aria-live={announceContextNotice ? 'polite' : undefined}
            >
              {contextNotice}
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
    </main>
  );
}

function App() {
  const [state, setState] = useState<AppState>(createInitialState);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number>(Date.now());
  const [recoveryNow, setRecoveryNow] = useState(Date.now());
  const [contextNow, setContextNow] = useState(Date.now());

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

  useEffect(() => {
    const now = Date.now();
    const latestActivity =
      state.autoStartFavoriteGames && state.twitchSessionDetected
        ? getRecentAutomationActivity(state.automationActivity, now)
        : null;
    if (!latestActivity) return;
    setContextNow(now);
    const remaining = AUTOMATION_NOTICE_TTL_MS - (now - latestActivity.at);
    if (remaining <= 0) return;
    const timer = window.setTimeout(() => setContextNow(Date.now()), remaining);
    return () => window.clearTimeout(timer);
  }, [state.autoStartFavoriteGames, state.automationActivity, state.twitchSessionDetected]);

  return (
    <MonitorView
      state={state}
      lastUpdatedAt={lastUpdatedAt}
      recoveryNow={recoveryNow}
      contextNow={contextNow}
    />
  );
}

export default App;
