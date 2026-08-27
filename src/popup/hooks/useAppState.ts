// Extracted from src/popup/App.tsx (App state loading + live subscription).
import { useEffect, useState } from 'react';
import { loadStoredAppState, subscribeToAppState } from '../../shared/app-state-sync';
import { sendRuntimeMessage } from '../../shared/messages.ts';
import { createInitialState } from '../../shared/utils';
import type { AppState } from '../../types';
import { logPopupError } from '../logging';

export function useAppState() {
  const [state, setState] = useState<AppState>(createInitialState());
  const [loading, setLoading] = useState(true);
  const [gamesLoading, setGamesLoading] = useState(true);
  useEffect(() => {
    const loadState = async () => {
      try {
        setState(await loadStoredAppState());
        const activation = await sendRuntimeMessage({ type: 'ACTIVATE_POPUP' });
        if (activation?.appState) setState(activation.appState);
      } catch (error) {
        logPopupError('Error loading state:', error);
      } finally {
        setLoading(false);
        setGamesLoading(false);
      }
    };

    loadState();

    return subscribeToAppState((nextState) => {
      setState(nextState);
    });
  }, []);

  return { state, setState, loading, gamesLoading };
}
