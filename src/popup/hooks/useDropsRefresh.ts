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

export function useDropsRefresh({ state, setState, setQueueMessage, isStale }: UseDropsRefreshArgs) {
  const [manualDropsRefreshLoading, setManualDropsRefreshLoading] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [autoRefreshAttemptedFor, setAutoRefreshAttemptedFor] = useState<number | null>(null);

  const dropsRefreshLoading = manualDropsRefreshLoading || state.dropsPageRefreshInProgress;
  const activeSyncError = dropsRefreshLoading ? null : (syncError ?? state.lastDropsPageRefreshError ?? null);

  useEffect(() => {
    if (dropsRefreshLoading) {
      setSyncError(null);
    }
  }, [dropsRefreshLoading]);

  const openDropsPage = useCallback(
    async (options: { active?: boolean } = {}) => {
      if (dropsRefreshLoading) {
        return;
      }
      const active = options.active !== false;

      setManualDropsRefreshLoading(true);
      setQueueMessage(null);
      setSyncError(null);
      const attemptAt = Date.now();
      setState((prev) => ({
        ...prev,
        dropsPageRefreshInProgress: true,
        lastDropsPageRefreshAttemptAt: attemptAt,
        lastDropsPageRefreshError: null,
      }));

      try {
        const response = await sendRuntimeMessage({
          type: 'OPEN_DROPS_PAGE_AND_REFRESH',
          payload: { waitForRefresh: false, active },
        }).catch((error: unknown) => ({
          success: false as const,
          opened: false,
          refreshed: false,
          gamesCount: 0,
          appState: undefined,
          error: String(error),
        }));
        const errorMessage = response?.error ?? '';
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
        }
      } finally {
        setManualDropsRefreshLoading(false);
      }
    },
    [dropsRefreshLoading, setQueueMessage, setState],
  );

  useEffect(() => {
    const refreshKey = state.lastSuccessfulRefreshAt ?? 0;
    if (
      !isStale ||
      dropsRefreshLoading ||
      activeSyncError ||
      refreshKey === 0 ||
      autoRefreshAttemptedFor === refreshKey
    ) {
      return;
    }
    setAutoRefreshAttemptedFor(refreshKey);
    void openDropsPage({ active: false });
  }, [
    activeSyncError,
    autoRefreshAttemptedFor,
    dropsRefreshLoading,
    isStale,
    openDropsPage,
    state.lastSuccessfulRefreshAt,
  ]);

  return { dropsRefreshLoading, activeSyncError, openDropsPage };
}
