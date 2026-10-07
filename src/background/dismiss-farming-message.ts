import { farmingMessages } from '../shared/farming-messages.ts';
import type { ServiceWorkerState } from './runtime-state.ts';

export async function dismissFarmingMessage(
  state: ServiceWorkerState,
  id: string,
  save: () => Promise<void>,
) {
  if (
    !farmingMessages(state.appState).some((message) => message.id === id) &&
    !state.appState.dismissedFarmingMessageIds.includes(id)
  )
    return { success: false, error: 'This farming message is no longer available.' };
  const previous = state.appState.dismissedFarmingMessageIds;
  state.appState.dismissedFarmingMessageIds = [...new Set([...previous, id])];
  try {
    await save();
  } catch {
    state.appState.dismissedFarmingMessageIds = previous;
    return { success: false, error: 'Unable to save the dismissed message.' };
  }
  return { success: true };
}
