import { gameKey } from '../shared/game-selection.ts';
import type { AppState, TwitchGame } from '../types/index.ts';
import { recordAutomationActivity } from './automation-activity.ts';
import type { AutomationEventNotifier } from './automation-event-notifier.ts';
import { logWarn } from './logging.ts';
import type { ServiceWorkerState } from './runtime-state.ts';

export interface CampaignUnfarmableWarningDependencies {
  readonly now: () => number;
  readonly saveState: (state: ServiceWorkerState) => Promise<void>;
  readonly broadcastStateUpdate: (appState: AppState) => void;
  readonly notifyAutomation: AutomationEventNotifier['notify'];
}

export function campaignUnfarmableWarningMessage(game: TwitchGame): string {
  return `The ${game.name} campaign is no longer farmable. DropHunter is moving to the next campaign.`;
}

export async function publishCampaignUnfarmableWarning(
  state: ServiceWorkerState,
  game: TwitchGame,
  dependencies: CampaignUnfarmableWarningDependencies,
): Promise<boolean> {
  const identity = gameKey(game);
  const id = `campaign-unfarmable:${identity}`;
  if (state.appState.automationActivity.some((entry) => entry.id === id)) {
    return false;
  }

  const message = campaignUnfarmableWarningMessage(game);
  recordAutomationActivity(state.appState, {
    id,
    kind: 'campaign-unfarmable',
    at: dependencies.now(),
    campaignId: game.campaignId,
    message,
  });

  try {
    await dependencies.saveState(state);
  } catch (error) {
    logWarn('Failed to persist campaign unfarmable warning', { error: String(error), identity });
  }
  dependencies.broadcastStateUpdate(state.appState);

  try {
    await dependencies.notifyAutomation({
      transitionId: id,
      event: 'unfarmable',
      campaignId: game.campaignId ?? identity,
      title: 'Campaign no longer farmable',
      message,
      priority: 2,
      telegramReason: 'unverifiable-twitch',
    });
  } catch (error) {
    logWarn('Campaign unfarmable warning delivery failed', { error: String(error), identity });
  }
  return true;
}
