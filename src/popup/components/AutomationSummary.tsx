import { useEffect, useState } from 'react';
import type { AppState } from '../../types';

const AUTOMATION_EVENT_TTL_MS = 6_000;

interface AutomationSummaryProps {
  readonly state: AppState;
  readonly notificationPermissionDenied: boolean;
  readonly onToggle: () => void | Promise<void>;
}

export function AutomationSummary({ state, notificationPermissionDenied, onToggle }: AutomationSummaryProps) {
  const latestActivity = state.automationActivity?.[0] ?? null;
  const canShowActivity = state.autoStartFavoriteGames && state.twitchSessionDetected;
  const [visibleActivityAt, setVisibleActivityAt] = useState<number | null>(() => {
    if (!canShowActivity || !latestActivity) return null;
    return Date.now() - latestActivity.at < AUTOMATION_EVENT_TTL_MS ? latestActivity.at : null;
  });

  useEffect(() => {
    if (!canShowActivity || !latestActivity) {
      setVisibleActivityAt(null);
      return;
    }
    const remaining = AUTOMATION_EVENT_TTL_MS - (Date.now() - latestActivity.at);
    if (remaining <= 0) {
      setVisibleActivityAt(null);
      return;
    }
    setVisibleActivityAt(latestActivity.at);
    const timeout = globalThis.setTimeout(() => setVisibleActivityAt(null), remaining);
    return () => globalThis.clearTimeout(timeout);
  }, [canShowActivity, latestActivity]);

  const visibleActivity =
    latestActivity && latestActivity.at === visibleActivityAt ? latestActivity.message : null;
  const warning = notificationPermissionDenied
    ? 'Notifications are required to turn on favorite auto-start.'
    : null;

  return (
    <section className="dh-subpanel dh-contain px-2.5 py-2" aria-labelledby="automation-summary-heading">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 id="automation-summary-heading" className="dh-title text-xs">
            Favorite auto-start
          </h2>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={state.autoStartFavoriteGames}
          aria-label="Toggle favorite auto-start"
          onClick={() => void onToggle()}
          className={`dh-switch shrink-0 dh-focus ${state.autoStartFavoriteGames ? 'dh-switch--on' : ''}`}
        >
          <span className="dh-switch__thumb" />
        </button>
      </div>
      {warning && (
        <p className="mt-1.5 text-[10px] text-[color:var(--dh-danger)]" role="status" aria-live="polite">
          {warning}
        </p>
      )}
      {visibleActivity && (
        <p
          className="mt-1.5 text-[10px] leading-snug text-[color:var(--dh-text-soft)]"
          role="status"
          aria-live="polite"
        >
          {visibleActivity}
        </p>
      )}
    </section>
  );
}
