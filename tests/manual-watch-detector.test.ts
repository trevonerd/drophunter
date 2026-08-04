import { describe, expect, test } from 'bun:test';
import { detectManualViewing } from '../src/background/manual-watch-detector.ts';
import type { TwitchGame } from '../src/types/index.ts';

const target: TwitchGame = {
  id: 'valorant',
  name: 'Valorant',
  categorySlug: 'valorant',
  campaignId: 'campaign-a',
  imageUrl: '',
  allowedChannels: ['eligible'],
};

describe('detectManualViewing', () => {
  test('recognizes an eligible active user Twitch tab without mutating it', async () => {
    const calls: number[] = [];
    const result = await detectManualViewing({
      target,
      managedTabId: 9,
      automationActive: true,
      now: 100,
      queryTabs: async () => [
        { id: 9, active: true, url: 'https://www.twitch.tv/managed' },
        { id: 4, active: true, url: 'https://www.twitch.tv/eligible' },
      ],
      getStreamContext: async (tabId) => {
        calls.push(tabId);
        return {
          channelName: 'eligible',
          categorySlug: 'valorant',
          isLive: true,
          isPlaybackReady: true,
          hasDropsEnabled: true,
        };
      },
    });

    expect(calls).toEqual([4]);
    expect(result).toEqual({ kind: 'eligible-manual', reason: 'eligible-channel' });
  });

  test('pauses automation for a visible ineligible manual Twitch stream', async () => {
    const result = await detectManualViewing({
      target,
      managedTabId: null,
      automationActive: true,
      now: 100,
      queryTabs: async () => [{ id: 4, active: true, url: 'https://www.twitch.tv/other' }],
      getStreamContext: async () => ({
        channelName: 'other',
        categorySlug: 'another-game',
        isLive: true,
        isPlaybackReady: true,
        hasDropsEnabled: false,
      }),
    });

    expect(result).toEqual({ kind: 'automation-paused', reason: 'ineligible-manual-view' });
  });

  test('does not classify a paused Twitch video as manual viewing', async () => {
    const result = await detectManualViewing({
      target,
      managedTabId: null,
      automationActive: true,
      now: 100,
      queryTabs: async () => [{ id: 4, active: true, url: 'https://www.twitch.tv/paused' }],
      getStreamContext: async () => ({
        channelName: 'other',
        categorySlug: 'another-game',
        isLive: true,
        isPlaybackReady: false,
        hasDropsEnabled: true,
      }),
    });

    expect(result).toEqual({ kind: 'inactive', reason: 'no-recent-visible-twitch' });
  });

  test('returns inactive when tab detection fails', async () => {
    const result = await detectManualViewing({
      target,
      managedTabId: null,
      automationActive: true,
      now: 100,
      queryTabs: async () => {
        throw new Error('tabs unavailable');
      },
      getStreamContext: async () => null,
    });

    expect(result).toEqual({ kind: 'inactive', reason: 'no-recent-visible-twitch' });
  });

  test('ignores inactive, non-Twitch, missing-context and managed tabs', async () => {
    const result = await detectManualViewing({
      target,
      managedTabId: 1,
      automationActive: true,
      now: 100,
      queryTabs: async () => [
        { id: 1, active: true, url: 'https://www.twitch.tv/managed' },
        { id: 2, active: false, url: 'https://www.twitch.tv/other' },
        { id: 3, active: true, url: 'https://example.com/' },
        { id: 4, active: true, url: 'https://www.twitch.tv/missing' },
      ],
      getStreamContext: async () => null,
    });

    expect(result).toEqual({ kind: 'inactive', reason: 'no-recent-visible-twitch' });
  });
});
