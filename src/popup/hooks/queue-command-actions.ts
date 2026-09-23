import { gameKey, getGameDisplayLabel } from '../../shared/game-selection.ts';
import { sendRuntimeMessage } from '../../shared/messages.ts';
import type { TwitchGame } from '../../types/index.ts';
import { logPopupWarn } from '../logging.ts';

export async function reorderQueueAction(
  fromIndex: number,
  toIndex: number,
  publish: (message: string) => void,
): Promise<void> {
  try {
    const response = await sendRuntimeMessage({ type: 'REORDER_QUEUE', payload: { fromIndex, toIndex } });
    if (!response?.success) publish(response?.error ?? 'Unable to reorder queue.');
  } catch (error: unknown) {
    logPopupWarn('REORDER_QUEUE failed:', error instanceof Error ? error : String(error));
    publish('Unable to reorder queue.');
  }
}

export async function startQueuedCampaignAction(
  game: TwitchGame,
  publish: (message: string) => void,
  setLoading: (loading: boolean) => void,
): Promise<void> {
  setLoading(true);
  try {
    const response = await sendRuntimeMessage({
      type: 'START_QUEUED_CAMPAIGN',
      payload: { campaignKey: gameKey(game) },
    });
    publish(
      response?.success
        ? `Started "${getGameDisplayLabel(game)}".`
        : (response?.error ?? 'Unable to start this campaign.'),
    );
  } catch (error: unknown) {
    logPopupWarn('START_QUEUED_CAMPAIGN failed:', error instanceof Error ? error : String(error));
    publish('Unable to start this campaign.');
  } finally {
    setLoading(false);
  }
}
