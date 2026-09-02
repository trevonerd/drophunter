import { describe, expect, test } from 'bun:test';
import {
  campaignUnfarmableWarningMessage,
  publishCampaignUnfarmableWarning,
} from '../src/background/campaign-unfarmable-warning.ts';
import { createServiceWorkerState } from '../src/background/runtime-state.ts';
import { normalizeStoredAppState } from '../src/shared/app-state-sync.ts';
import type { TwitchGame } from '../src/types/index.ts';

const campaign: TwitchGame = {
  id: 'game-1',
  name: 'Example Game',
  imageUrl: '',
  campaignId: 'campaign-1',
  campaignName: 'Example Campaign',
};

describe('campaign unfarmable warning', () => {
  test('persists one exact warning per campaign identity before publishing enabled channels', async () => {
    const state = createServiceWorkerState();
    const events: string[] = [];
    const messages: string[] = [];
    const dependencies = {
      now: () => 123,
      saveState: async () => {
        events.push('saved');
      },
      broadcastStateUpdate: () => {
        events.push('popup');
      },
      notifyBrowser: async (message: string) => {
        events.push('browser');
        messages.push(message);
      },
      notifyTelegram: async (message: string) => {
        events.push('telegram');
        messages.push(message);
      },
    };

    const first = await publishCampaignUnfarmableWarning(state, campaign, dependencies);
    const restartedState = createServiceWorkerState();
    restartedState.appState = normalizeStoredAppState(structuredClone(state.appState));
    const duplicate = await publishCampaignUnfarmableWarning(restartedState, campaign, dependencies);

    const expected = campaignUnfarmableWarningMessage(campaign);
    expect(first).toBe(true);
    expect(duplicate).toBe(false);
    expect(events).toEqual(['saved', 'popup', 'browser', 'telegram']);
    expect(messages).toEqual([expected, expected]);
    expect(state.appState.automationActivity).toEqual([
      {
        id: 'campaign-unfarmable:campaign:campaign-1',
        kind: 'campaign-unfarmable',
        at: 123,
        campaignId: 'campaign-1',
        message: expected,
      },
    ]);
    expect(state.appState.lastAutomationMessage).toBe(expected);
  });
});
