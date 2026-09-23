import { type Dispatch, type SetStateAction, useCallback, useEffect, useReducer, useState } from 'react';
import { browser } from '../../shared/browser-api.ts';
import { gameCategoryIdentityKeys, gameCategoryKey, getGameDisplayLabel } from '../../shared/game-selection';
import { sendRuntimeMessage } from '../../shared/messages';
import type { AppState, GamePreference, TwitchGame } from '../../types';
import { formatFarmingCompleteQueueMessage } from '../format';
import { logPopupWarn } from '../logging';
import { INITIAL_QUEUE_FEEDBACK_STATE, publishQueueFeedback } from '../queue-feedback';
import { getGameToStartFromQueue } from '../queue-start';
import { reorderQueueAction, startQueuedCampaignAction } from './queue-command-actions.ts';
import { useQueueCleanupDismissal } from './useQueueCleanupDismissal';

const QUEUE_MESSAGE_DISMISS_MS = 6_000;

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
  const { dismissedQueueCleanupActivityId, handleDismissQueueCleanup } = useQueueCleanupDismissal();
  const [queueFeedback, setQueueMessage] = useReducer(publishQueueFeedback, INITIAL_QUEUE_FEEDBACK_STATE);
  const queueMessage = queueFeedback.message;
  const queueMessageOccurrence = queueFeedback.occurrence;

  useEffect(() => {
    if (queueMessage === null || queueMessageOccurrence === 0) return;
    const timeout = globalThis.setTimeout(() => setQueueMessage(null), QUEUE_MESSAGE_DISMISS_MS);
    return () => globalThis.clearTimeout(timeout);
  }, [queueMessage, queueMessageOccurrence]);

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

  const handleSetGamePreference = async (game: TwitchGame, preference: GamePreference): Promise<boolean> => {
    const previousState = {
      favoriteGames: state.favoriteGames,
      hiddenGames: state.hiddenGames,
      queueEntryMetadataByKey: state.queueEntryMetadataByKey,
    };
    const aliases = new Set(gameCategoryIdentityKeys(game));
    setState((prev) => {
      const matches = (entry: { readonly gameId: string; readonly identityKeys?: readonly string[] }) =>
        [entry.gameId, ...(entry.identityKeys ?? [])].some((key) => aliases.has(key));
      const favoriteGames = prev.favoriteGames.filter((entry) => !matches(entry));
      const hiddenGames = prev.hiddenGames.filter((entry) => !matches(entry));
      if (preference === 'favorite') {
        favoriteGames.push({
          gameId: gameCategoryKey(game),
          lastKnownName: game.name,
          addedAt: Date.now(),
          identityKeys: gameCategoryIdentityKeys(game),
        });
      }
      if (preference === 'hidden') {
        hiddenGames.push({
          gameId: gameCategoryKey(game),
          lastKnownName: game.name,
          hiddenAt: Date.now(),
          identityKeys: gameCategoryIdentityKeys(game),
        });
      }
      return { ...prev, favoriteGames, hiddenGames };
    });
    const response = await sendRuntimeMessage({
      type: 'SET_GAME_PREFERENCE',
      payload: { game, preference },
    }).catch(() => null);
    if (!response?.success) {
      setState((previous) => ({
        ...previous,
        favoriteGames: previousState.favoriteGames,
        hiddenGames: previousState.hiddenGames,
        queueEntryMetadataByKey: previousState.queueEntryMetadataByKey,
      }));
      setQueueMessage('Unable to update game preference.');
      return false;
    }
    if (preference === 'favorite' && response.autoStart) {
      if (response.autoStart?.status === 'started') {
        setQueueMessage('Favorite saved. Farming started automatically.');
      } else if (response.autoStart?.status === 'waiting') {
        setQueueMessage(
          response.autoStart.reason === 'session'
            ? 'Favorite saved. Open Twitch Drops to restore the session.'
            : response.autoStart.reason === 'refresh-failed'
              ? 'Favorite saved. Twitch refresh failed; DropHunter will retry.'
              : 'Favorite saved. Waiting for authoritative campaign data; DropHunter will retry.',
        );
      } else if (response.autoStart?.status === 'queued') {
        setQueueMessage(
          response.autoStart.reason === 'manual-watch'
            ? 'Favorite saved. Manual Twitch viewing is active; farming will wait.'
            : response.autoStart.reason === 'streamer'
              ? 'Favorite saved. Waiting for an eligible streamer; DropHunter will retry.'
              : 'Favorite saved. Campaign queued for automatic farming.',
        );
      } else {
        setQueueMessage('Favorite saved. Automatic farming is disabled.');
      }
    }
    return true;
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

  const handleReorderQueue = (fromIndex: number, toIndex: number) =>
    reorderQueueAction(fromIndex, toIndex, setQueueMessage);

  const handleStartQueuedCampaign = (game: TwitchGame) => {
    if (actionLoading) return;
    return startQueuedCampaignAction(game, setQueueMessage, setActionLoading);
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
    dismissedQueueCleanupActivityId,
    setQueueMessage,
    handleAddToQueue,
    handleAddAllToQueue,
    handleLinkAccount,
    handleDismissQueueCleanup,
    handleSetGamePreference,
    handleRemoveFromQueue,
    handleClearQueue,
    handleReorderQueue,
    handleStartQueuedCampaign,
    handleStart,
    handlePause: useCallback(() => runFarmingControl('PAUSE_FARMING'), [runFarmingControl]),
    handleResume: useCallback(() => runFarmingControl('RESUME_FARMING'), [runFarmingControl]),
    handleStop: useCallback(() => runFarmingControl('STOP_FARMING'), [runFarmingControl]),
  };
}
