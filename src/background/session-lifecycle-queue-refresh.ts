import type { ServiceWorkerState } from './runtime-state.ts';
import type { QueueProgressOptions } from './session-lifecycle-types.ts';
import { saveTimingState } from './state-persistence.ts';

export async function refreshQueueHead(
  state: ServiceWorkerState,
  options?: QueueProgressOptions,
): Promise<void> {
  if (options?.onSaveTimingState) {
    await options.onSaveTimingState(state);
  } else {
    saveTimingState(state).catch(() => undefined);
  }
  if (options?.onEnsureWorkspace) {
    await options.onEnsureWorkspace();
  }
  if (options?.onRefreshDropsData) {
    await options.onRefreshDropsData({
      includeCampaignFetch: true,
      includeInventoryFetch: true,
      suppressNotifications: true,
    });
  }
}
