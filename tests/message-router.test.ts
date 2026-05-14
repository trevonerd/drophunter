import { describe, expect, test } from 'bun:test';
import {
  createRuntimeMessageListener,
  type RuntimeMessageHandlers,
} from '../src/background/message-router.ts';

function createHandlers(overrides: Partial<RuntimeMessageHandlers> = {}): RuntimeMessageHandlers {
  const missing = () => {
    throw new Error('unexpected handler');
  };

  return {
    ensureGamesCache: missing,
    openDropsPageAndRefresh: missing,
    addToQueue: missing,
    removeFromQueue: missing,
    clearQueue: missing,
    startFarming: missing,
    setSelectedGame: missing,
    pauseFarming: missing,
    setAutoResumeOnStartup: missing,
    resumeFarming: missing,
    stopFarming: missing,
    updateGames: missing,
    syncTwitchSession: missing,
    syncTwitchIntegrity: missing,
    refreshDrops: missing,
    setMonitorAutoOpen: missing,
    setMuteFarmingTab: missing,
    setNotificationsEnabled: missing,
    setAutoClaimChannelPointsBonus: missing,
    channelPointsBonusClaimed: missing,
    setAutoClaimDrops: missing,
    setStreamerSelectionMode: missing,
    setPreferredStreamerLanguage: missing,
    openMonitorDashboard: missing,
    ...overrides,
  };
}

async function callListener(
  listener: ReturnType<typeof createRuntimeMessageListener>,
  message: unknown,
  sender: chrome.runtime.MessageSender = {},
) {
  let response: unknown;
  const keepChannelOpen = listener(message, sender, (value?: unknown) => {
    response = value;
  });
  await Promise.resolve();
  await Promise.resolve();
  return { keepChannelOpen, response };
}

describe('runtime message router', () => {
  test('rejects unknown messages without invoking handlers', async () => {
    const listener = createRuntimeMessageListener(createHandlers());

    const result = await callListener(listener, { type: 'NOT_A_REAL_MESSAGE' });

    expect(result.keepChannelOpen).toBe(true);
    expect(result.response).toEqual({ success: false, error: 'Unknown message type' });
  });

  test('rejects critical messages with malformed payloads before invoking handlers', async () => {
    let startCalled = false;
    let syncCalled = false;
    const listener = createRuntimeMessageListener(
      createHandlers({
        startFarming: async () => {
          startCalled = true;
          return { success: true };
        },
        syncTwitchIntegrity: async () => {
          syncCalled = true;
          return { success: true };
        },
      }),
    );

    const start = await callListener(listener, { type: 'START_FARMING', payload: { game: null } });
    const integrity = await callListener(listener, {
      type: 'SYNC_TWITCH_INTEGRITY',
      payload: { token: 123 },
    });

    expect(start.response).toEqual({ success: false, error: 'Invalid message payload' });
    expect(integrity.response).toEqual({ success: false, error: 'Invalid message payload' });
    expect(startCalled).toBe(false);
    expect(syncCalled).toBe(false);
  });

  test('rejects messages that are not handled by the background service worker', async () => {
    const listener = createRuntimeMessageListener(createHandlers());

    const result = await callListener(listener, { type: 'GET_STREAM_CONTEXT' });

    expect(result.keepChannelOpen).toBe(true);
    expect(result.response).toEqual({ success: false, error: 'Unsupported message target' });
  });

  test('returns async handler results and converts thrown errors into response errors', async () => {
    const listener = createRuntimeMessageListener(
      createHandlers({
        pauseFarming: async () => ({ success: true, paused: true }),
        resumeFarming: async () => {
          throw new Error('resume failed');
        },
      }),
    );

    const pause = await callListener(listener, { type: 'PAUSE_FARMING' });
    const resume = await callListener(listener, { type: 'RESUME_FARMING' });

    expect(pause.response).toEqual({ success: true, paused: true });
    expect(resume.response).toEqual({ success: false, error: 'Error: resume failed' });
  });
});
