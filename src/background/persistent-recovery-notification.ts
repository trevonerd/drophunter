import { gameKey } from '../shared/game-selection.ts';
import type { AutomationEventNotifier } from './automation-event-notifier.ts';
import { enterPersistentRecovery } from './recovery-state.ts';
import type { EnterPersistentRecoveryFn } from './streamer-acquisition-contracts.ts';

type PersistentRecoveryNotificationInput = {
  readonly automationNotify?: AutomationEventNotifier['notify'];
  readonly notify: (title: string, message: string, priority?: number) => Promise<void>;
  readonly telegramSystemAlert?: (reason: string, message: string) => Promise<void>;
};

export function createPersistentRecoveryHandler(
  input: PersistentRecoveryNotificationInput,
): EnterPersistentRecoveryFn {
  const automationNotify = input.automationNotify;
  return async (state, reason, message, recoveryOptions) =>
    enterPersistentRecovery(state, reason, message, {
      ...recoveryOptions,
      onNotify: automationNotify
        ? async (title, notificationMessage, priority) => {
            const selectedGame = state.appState.selectedGame;
            if (!selectedGame) return;
            await automationNotify({
              transitionId: `persistent-recovery:${gameKey(selectedGame)}:${state.stalledRecoveryAttempts}:${state.lastRecoveryAttemptAt}`,
              event: 'recovery',
              campaignId: selectedGame.campaignId ?? selectedGame.id,
              title,
              message: notificationMessage,
              priority,
              telegramReason: 'recovery',
            });
          }
        : input.notify,
      ...(!automationNotify && input.telegramSystemAlert ? { onSystemAlert: input.telegramSystemAlert } : {}),
    });
}
