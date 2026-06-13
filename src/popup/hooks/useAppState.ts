// Extracted from src/popup/App.tsx (App state loading + live subscription).
import { useEffect, useRef, useState } from 'react';
import { loadStoredAppState, subscribeToAppState } from '../../shared/app-state-sync';
import { createInitialState } from '../../shared/utils';
import type { AppState } from '../../types';
import { logPopupError } from '../logging';
import { queueGameIdentity } from '../queue-start';

export function useAppState() {
  const [state, setState] = useState<AppState>(createInitialState());
  const [loading, setLoading] = useState(true);
  const [gamesLoading, setGamesLoading] = useState(true);
  const [rewardsLoading, setRewardsLoading] = useState(false);
  const pendingGameRef = useRef<string | null>(null);

  const beginRewardsLoad = (gameIdentity: string) => {
    pendingGameRef.current = gameIdentity;
    setRewardsLoading(true);
  };

  useEffect(() => {
    const loadState = async () => {
      try {
        setState(await loadStoredAppState());
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
      if (pendingGameRef.current === null) {
        // No game load in flight — clear on every broadcast (existing behavior).
        setRewardsLoading(false);
      } else {
        const arrivedGame = nextState.selectedGame ? queueGameIdentity(nextState.selectedGame) : null;
        if (arrivedGame === pendingGameRef.current) {
          pendingGameRef.current = null;
          setRewardsLoading(false);
        }
        // Else: broadcast is for a different/earlier game — keep spinner up.
      }
    });
  }, []);

  return { state, setState, loading, gamesLoading, rewardsLoading, setRewardsLoading, beginRewardsLoad };
}
