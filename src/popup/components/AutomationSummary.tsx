import { useEffect, useState } from 'react';
import type { AppState } from '../../types';

const AUTOMATION_EVENT_TTL_MS = 6_000;

export function AutomationSummary({ state }: { readonly state: AppState }) {
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
  const policyCopy = state.autoStartFavoriteGames
    ? 'New campaigns for favorite games are added and started automatically.'
    : 'Automatic farming for favorite games is off.';

  return (
    <section className="dh-panel dh-contain px-3 py-2" aria-labelledby="automation-summary-heading">
      <h2 id="automation-summary-heading" className="dh-title text-xs">
        Automation: {state.autoStartFavoriteGames ? 'On' : 'Off'}
      </h2>
      <p
        className="mt-1 text-[11px] leading-snug text-[color:var(--dh-text-soft)]"
        role={visibleActivity ? 'status' : undefined}
        aria-live={visibleActivity ? 'polite' : undefined}
      >
        {visibleActivity ?? policyCopy}
      </p>
    </section>
  );
}
