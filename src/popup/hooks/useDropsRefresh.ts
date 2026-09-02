// Extracted from src/popup/App.tsx (Drops page refresh + stale auto-refresh).
import { type Dispatch, type SetStateAction, useCallback, useEffect, useState } from 'react';
import { loadStoredAppState } from '../../shared/app-state-sync';
import { sendRuntimeMessage } from '../../shared/messages';
import type { AppState } from '../../types';
import { logPopupWarn } from '../logging';

interface UseDropsRefreshArgs {
  state: AppState;
  setState: Dispatch<SetStateAction<AppState>>;
  setQueueMessage: Dispatch<SetStateAction<string | null>>;
  isStale: boolean;
}

export function useDropsRefresh({ state, setState, setQueueMessage }: UseDropsRefreshArgs) {
  const [manualDropsRefreshLoading, setManualDropsRefreshLoading] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [manualRefreshCampaignCount, setManualRefreshCampaignCount] = useState<number | null>(null);

  const hasUsableCachedState = state.availableGames.length > 0 || state.isRunning;
  const dropsRefreshLoading =
    manualDropsRefreshLoading || (state.dropsPageRefreshInProgress && !hasUsableCachedState);
  const activeSyncError = dropsRefreshLoading ? null : syncError;

  useEffect(() => {
    if (dropsRefreshLoading) {
      setSyncError(null);
    }
  }, [dropsRefreshLoading]);

  useEffect(() => {
    if (manualRefreshCampaignCount === null) return;
    const timer = window.setTimeout(() => setManualRefreshCampaignCount(null), 6_000);
    return () => window.clearTimeout(timer);
  }, [manualRefreshCampaignCount]);

  const openDropsPage = useCallback(
    async (_options: { active?: boolean } = {}) => {
      if (dropsRefreshLoading) {
        return;
      }
      setManualDropsRefreshLoading(true);
      setQueueMessage(null);
      setSyncError(null);
      setManualRefreshCampaignCount(null);
      const attemptAt = Date.now();
      setState((prev) => ({
        ...prev,
        dropsPageRefreshInProgress: true,
        lastDropsPageRefreshAttemptAt: attemptAt,
        lastDropsPageRefreshError: null,
      }));

      try {
        const response = await sendRuntimeMessage({
          type: 'OPEN_DROPS_AND_SYNC',
        }).catch((error: unknown) => ({
          success: false as const,
          result: undefined,
          appState: undefined,
          error: String(error),
        }));
        const errorMessage = response?.error ?? '';
        if (response?.appState) setState(response.appState);
        if (!response?.success) {
          let visibleError = errorMessage || 'Refresh failed.';
          if (/sign in|session/i.test(errorMessage)) {
            visibleError = 'Sign in to Twitch, then refresh campaigns again.';
          } else if (/No active Twitch Drops campaigns/i.test(errorMessage)) {
            visibleError = 'No active Twitch Drops campaigns were detected.';
          }
          const freshState = await loadStoredAppState().catch((error: unknown) => {
            logPopupWarn('Unable to reload state after drops refresh launch:', error);
            return null;
          });
          if (freshState) {
            setState(freshState);
          }
          setState((prev) => ({
            ...prev,
            dropsPageRefreshInProgress: false,
            lastDropsPageRefreshAttemptAt: prev.lastDropsPageRefreshAttemptAt ?? attemptAt,
            lastDropsPageRefreshError: visibleError,
          }));
          setSyncError(visibleError);
        } else {
          setManualRefreshCampaignCount(
            response.appState?.availableGames.length ?? state.availableGames.length,
          );
        }
      } finally {
        setManualDropsRefreshLoading(false);
      }
    },
    [dropsRefreshLoading, setQueueMessage, setState, state.availableGames.length],
  );

  return { dropsRefreshLoading, activeSyncError, manualRefreshCampaignCount, openDropsPage };
}
