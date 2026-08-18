import { type Dispatch, type SetStateAction, useCallback, useState } from 'react';
import { browser } from '../../shared/browser-api.ts';
import {
  favoriteGameIdentityKeys,
  gameCategoryIdentityKeys,
  gameCategoryKey,
  getGameDisplayLabel,
  isFavoriteGame,
} from '../../shared/game-selection';
import { sendRuntimeMessage } from '../../shared/messages';
import type { AppState, TwitchGame } from '../../types';
import { formatFarmingCompleteQueueMessage } from '../format';
import { logPopupWarn } from '../logging';
import { getGameToStartFromQueue } from '../queue-start';

interface UsePopupActionsArgs {
  readonly state: AppState;
  readonly setState: Dispatch<SetStateAction<AppState>>;
  readonly queueGames: TwitchGame[];
  readonly hasCompletedOnboarding: boolean;
  readonly setOnboardingCompleted: Dispatch<SetStateAction<boolean>>;
  readonly onboardingStep: 'selector' | 'start' | null;
  readonly setOnboardingStep: Dispatch<SetStateAction<'selector' | 'start' | null>>;
}

export function usePopupActions({
  state,
  setState,
  queueGames,
  hasCompletedOnboarding,
  setOnboardingCompleted,
  onboardingStep,
  setOnboardingStep,
}: UsePopupActionsArgs) {
  const [actionLoading, setActionLoading] = useState(false);
  const [queueMessage, setQueueMessage] = useState<string | null>(null);

  const handleAddToQueue = async (requestedGame: TwitchGame | null = state.selectedGame) => {
    if (!requestedGame || actionLoading) return;
    setActionLoading(true);
    try {
      const response = await sendRuntimeMessage({
        type: 'ADD_TO_QUEUE',
        payload: { game: requestedGame },
      });
      if (!response?.success) {
        setQueueMessage('Unable to add campaign to queue.');
      } else if (response.added) {
        if (onboardingStep === 'selector') setOnboardingStep('start');
        setQueueMessage(`Added "${getGameDisplayLabel(requestedGame)}" to queue.`);
      } else if (response.reason === 'farming-complete') {
        setQueueMessage(formatFarmingCompleteQueueMessage(requestedGame));
      } else if (response.reason === 'already-completed') {
        setQueueMessage(`"${getGameDisplayLabel(requestedGame)}" already has all rewards completed.`);
      } else if (response.reason === 'already-queued') {
        setQueueMessage(`"${getGameDisplayLabel(requestedGame)}" is already in queue.`);
      } else {
        setQueueMessage(`"${getGameDisplayLabel(requestedGame)}" was not added to queue.`);
      }
    } catch {
      setQueueMessage('Queue add failed.');
    } finally {
      setTimeout(() => setActionLoading(false), 250);
    }
  };

  const handleAddAllToQueue = async (games: readonly TwitchGame[]) => {
    if (games.length === 0 || actionLoading) return;
    setActionLoading(true);
    let added = 0;
    try {
      for (const game of games) {
        const response = await sendRuntimeMessage({ type: 'ADD_TO_QUEUE', payload: { game } });
        if (response?.success && response.added) added += 1;
      }
      setQueueMessage(
        added > 0
          ? `Added ${added} ${added === 1 ? 'campaign' : 'campaigns'} to queue.`
          : 'No additional farmable campaigns were added.',
      );
      if (added > 0 && onboardingStep === 'selector') setOnboardingStep('start');
    } catch {
      setQueueMessage('Unable to add all available campaigns.');
    } finally {
      setTimeout(() => setActionLoading(false), 250);
    }
  };

  const handleLinkAccount = () => {
    void Promise.all([
      browser.alarms.create('campaignLinkRecheck:1', { delayInMinutes: 0.5 }),
      browser.alarms.create('campaignLinkRecheck:2', { delayInMinutes: 1.5 }),
    ]).catch(() => undefined);
  };

  const handleSetFavorite = async (game: TwitchGame, favorite: boolean) => {
    const previousFavorites = state.favoriteGames;
    const categoryKey = gameCategoryKey(game);
    const categoryAliases = new Set(gameCategoryIdentityKeys(game));
    setState((prev) => ({
      ...prev,
      favoriteGames: favorite
        ? isFavoriteGame(game, favoriteGameIdentityKeys(prev.favoriteGames))
          ? prev.favoriteGames
          : [
              ...prev.favoriteGames,
              {
                gameId: categoryKey,
                lastKnownName: game.name,
                addedAt: Date.now(),
                identityKeys: gameCategoryIdentityKeys(game),
              },
            ]
        : prev.favoriteGames.filter(
            (entry) => ![entry.gameId, ...(entry.identityKeys ?? [])].some((key) => categoryAliases.has(key)),
          ),
    }));
    const response = await sendRuntimeMessage({
      type: 'SET_GAME_FAVORITE',
      payload: { game, favorite },
    }).catch(() => null);
    if (!response?.success) {
      setState((previous) => ({ ...previous, favoriteGames: previousFavorites }));
      setQueueMessage('Unable to update favorite games.');
    }
  };

  const handleRemoveFromQueue = async (game: TwitchGame) => {
    try {
      const response = await sendRuntimeMessage({ type: 'REMOVE_FROM_QUEUE', payload: { game } });
      if (!response?.success || response.removed === 0) {
        setQueueMessage(response?.error ?? 'Unable to remove campaign from queue.');
      }
    } catch (error: unknown) {
      logPopupWarn('REMOVE_FROM_QUEUE failed:', error instanceof Error ? error : String(error));
      setQueueMessage('Unable to remove campaign from queue.');
    }
  };

  const handleClearQueue = async () => {
    try {
      const response = await sendRuntimeMessage({ type: 'CLEAR_QUEUE' });
      if (response?.success === false) {
        setQueueMessage(response.error ?? 'Unable to clear queue.');
        return;
      }
      setQueueMessage('Queue cleared.');
    } catch (error: unknown) {
      logPopupWarn('CLEAR_QUEUE failed:', error instanceof Error ? error : String(error));
      setQueueMessage('Unable to clear queue.');
    }
  };

  const handleReorderQueue = async (fromIndex: number, toIndex: number) => {
    try {
      const response = await sendRuntimeMessage({
        type: 'REORDER_QUEUE',
        payload: { fromIndex, toIndex },
      });
      if (!response?.success) setQueueMessage(response?.error ?? 'Unable to reorder queue.');
    } catch (error: unknown) {
      logPopupWarn('REORDER_QUEUE failed:', error instanceof Error ? error : String(error));
      setQueueMessage('Unable to reorder queue.');
    }
  };

  const runFarmingControl = useCallback(
    async (type: 'PAUSE_FARMING' | 'RESUME_FARMING' | 'STOP_FARMING') => {
      if (actionLoading) return;
      setActionLoading(true);
      try {
        await sendRuntimeMessage({ type });
      } finally {
        setTimeout(() => setActionLoading(false), 250);
      }
    },
    [actionLoading],
  );

  const handleStart = async () => {
    if (actionLoading) return;
    setActionLoading(true);
    try {
      const gameToStart = getGameToStartFromQueue(state.selectedGame, queueGames);
      if (!gameToStart) {
        setQueueMessage('Select a campaign to start farming.');
        return;
      }
      const response = await sendRuntimeMessage({ type: 'START_FARMING', payload: { game: gameToStart } });
      if (response && !response.success && response.error) {
        setQueueMessage(response.error);
        return;
      }
      if (response?.success && !hasCompletedOnboarding) {
        setOnboardingCompleted(true);
        setOnboardingStep(null);
        await browser.storage.local.set({ onboardingCompleted: true }).catch(() => {});
      }
    } finally {
      setTimeout(() => setActionLoading(false), 250);
    }
  };

  return {
    actionLoading,
    queueMessage,
    setQueueMessage,
    handleAddToQueue,
    handleAddAllToQueue,
    handleLinkAccount,
    handleSetFavorite,
    handleRemoveFromQueue,
    handleClearQueue,
    handleReorderQueue,
    handleStart,
    handlePause: useCallback(() => runFarmingControl('PAUSE_FARMING'), [runFarmingControl]),
    handleResume: useCallback(() => runFarmingControl('RESUME_FARMING'), [runFarmingControl]),
    handleStop: useCallback(() => runFarmingControl('STOP_FARMING'), [runFarmingControl]),
  };
}
