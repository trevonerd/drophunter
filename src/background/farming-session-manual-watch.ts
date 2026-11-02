import type { TwitchGame } from '../types/index.ts';
import type { FarmingSessionContext } from './farming-session-context.ts';
import { logWarn } from './logging.ts';
import { resumeWatchObservation, suspendWatchObservation } from './streamer-watch-attempt.ts';

/** Reconciles manual viewing before automated playback; reward checks remain runnable. */
export async function reconcileSessionManualWatch(
  context: FarmingSessionContext,
  isCurrent: () => boolean,
  target: TwitchGame | null = context.state.appState.selectedGame,
): Promise<boolean> {
  const { state, adapters } = context;
  const directive = await context.manualWatchController.reconcileTransport({
    target,
    managedTabId: state.appState.tabId,
    preparingManagedTabIds: [...state.preparingManagedTabIds],
    automationActive: state.appState.isRunning && !state.appState.isPaused,
    transportSuspended: context.manualWatchTransportSuspended,
  });
  if (!isCurrent() || directive.kind === 'unavailable') return false;
  if (directive.kind === 'unchanged') return !context.manualWatchTransportSuspended;
  const suspended = directive.kind === 'suspend';
  if (suspended) {
    context.manualWatchTransportSuspended = true;
    suspendWatchObservation(state, context.now());
    try {
      await adapters.watchTransport?.stop();
    } catch (error) {
      logWarn('Manual watch transport suspension failed:', error instanceof Error ? error.name : 'unknown');
    }
  } else {
    resumeWatchObservation(state, context.now());
    context.manualWatchTransportSuspended = false;
  }
  if (!isCurrent()) return false;
  await adapters.saveState(state);
  if (!isCurrent()) return false;
  void Promise.resolve()
    .then(() =>
      adapters.automationNotify?.({
        transitionId: directive.transitionId,
        event: suspended ? 'manual-suspended' : 'manual-resumed',
        campaignId: target?.campaignId ?? 'manual-watch',
        title: suspended ? 'Manual viewing detected' : 'Automatic farming resumed',
        message: suspended
          ? 'DropHunter paused automatic farming while you watch Twitch.'
          : 'DropHunter resumed automatic farming after your Twitch viewing ended.',
        telegramReason: suspended ? 'manual-suspended' : 'manual-resumed',
      }),
    )
    .catch(() => undefined);
  return !suspended;
}
