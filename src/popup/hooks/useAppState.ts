// Extracted from src/popup/App.tsx (App state loading + live subscription).
import { useEffect, useState } from 'react';
import {
  loadStoredAppState,
  normalizeStoredAppState,
  subscribeToAppState,
} from '../../shared/app-state-sync';
import { sendRuntimeMessage } from '../../shared/messages.ts';
import { createInitialState } from '../../shared/utils';
import type { AppState } from '../../types';
import { logPopupError } from '../logging';

type PopupActivationResult = { readonly appState?: AppState } | null | undefined;

interface PopupHydrationOptions {
  readonly loadCachedState: () => Promise<AppState>;
  readonly activatePopup: () => Promise<PopupActivationResult>;
  readonly applyCachedState: (state: AppState) => void;
  readonly applyActivatedState: (state: AppState) => void;
  readonly finishBootstrap: () => void;
  readonly reportError: (message: string, error: unknown) => void;
}

export async function hydratePopupStateStaleWhileRevalidate({
  loadCachedState,
  activatePopup,
  applyCachedState,
  applyActivatedState,
  finishBootstrap,
  reportError,
}: PopupHydrationOptions): Promise<void> {
  try {
    applyCachedState(await loadCachedState());
  } catch (error) {
    reportError('Error loading cached popup state:', error);
  } finally {
    finishBootstrap();
  }

  try {
    const activation = await activatePopup();
    if (activation?.appState) applyActivatedState(normalizeStoredAppState(activation.appState));
  } catch (error) {
    reportError('Error activating popup sync:', error);
  }
}

export function useAppState() {
  const [state, setState] = useState<AppState>(createInitialState());
  const [loading, setLoading] = useState(true);
  const [gamesLoading, setGamesLoading] = useState(true);
  useEffect(() => {
    let disposed = false;
    let cachePhaseFinished = false;
    let pendingLiveState: AppState | null = null;
    const applyState = (nextState: AppState) => {
      if (!disposed) setState(normalizeStoredAppState(nextState));
    };
    const unsubscribe = subscribeToAppState((nextState) => {
      if (!cachePhaseFinished) {
        pendingLiveState = nextState;
        return;
      }
      applyState(nextState);
    });

    void hydratePopupStateStaleWhileRevalidate({
      loadCachedState: loadStoredAppState,
      activatePopup: () => sendRuntimeMessage({ type: 'ACTIVATE_POPUP' }),
      applyCachedState: applyState,
      applyActivatedState: applyState,
      finishBootstrap: () => {
        cachePhaseFinished = true;
        if (pendingLiveState) applyState(pendingLiveState);
        if (!disposed) {
          setLoading(false);
          setGamesLoading(false);
        }
      },
      reportError: logPopupError,
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  return { state, setState, loading, gamesLoading };
}
