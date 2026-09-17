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

  test('protects an actually playing eligible user Twitch tab in the background', async () => {
    // Given: the user leaves a real Twitch stream playing in an inactive tab.
    const result = await detectManualViewing({
      target,
      managedTabId: 9,
      automationActive: true,
      now: 100,
      queryTabs: async () => [{ id: 4, active: false, url: 'https://www.twitch.tv/eligible' }],
      getStreamContext: async () => ({
        channelName: 'eligible',
        categorySlug: 'valorant',
        isLive: true,
        isPlaybackReady: true,
        hasDropsEnabled: true,
      }),
    });

    // When: automation evaluates personal viewing.
    // Then: playback, not tab focus, suspends managed farming.
    expect(result).toEqual({ kind: 'eligible-manual', reason: 'eligible-channel' });
  });

  test('keeps farming suspended while any one of multiple personal Twitch tabs is playing', async () => {
    // Given: one stopped tab and one background stream that is still playing.
    const result = await detectManualViewing({
      target,
      managedTabId: null,
      automationActive: true,
      now: 100,
      queryTabs: async () => [
        { id: 4, active: false, url: 'https://www.twitch.tv/stopped' },
        { id: 5, active: false, url: 'https://www.twitch.tv/eligible' },
      ],
      getStreamContext: async (tabId) =>
        tabId === 4
          ? {
              channelName: 'stopped',
              categorySlug: 'another-game',
              isLive: true,
              isPlaybackReady: false,
            }
          : {
              channelName: 'eligible',
              categorySlug: 'valorant',
              isLive: true,
              isPlaybackReady: true,
              hasDropsEnabled: true,
            },
    });

    // When: personal streams are classified together.
    // Then: a stopped sibling does not hide the playing stream.
    expect(result).toEqual({ kind: 'eligible-manual', reason: 'eligible-channel' });
  });

  test('uses the most recently focused playing stream as the manual watch source', async () => {
    // Given: an older eligible stream and a newer playing stream for another game.
    const result = await detectManualViewing({
      target,
      managedTabId: null,
      automationActive: true,
      now: 100,
      queryTabs: async () => [
        { id: 4, active: false, lastAccessed: 100, url: 'https://www.twitch.tv/eligible' },
        { id: 5, active: true, lastAccessed: 200, url: 'https://www.twitch.tv/other-game' },
      ],
      getStreamContext: async (tabId) =>
        tabId === 4
          ? {
              channelName: 'eligible',
              categorySlug: 'valorant',
              isLive: true,
              isPlaybackReady: true,
              hasDropsEnabled: true,
            }
          : {
              channelName: 'other-game',
              categorySlug: 'another-game',
              isLive: true,
              isPlaybackReady: true,
            },
    });

    // When: the focused stream is classified.
    // Then: its mismatched game pauses automation instead of selecting an older eligible stream.
    expect(result).toEqual({ kind: 'automation-paused', reason: 'ineligible-manual-view' });
  });

  test.each([
    ['playing tab before stopped tab', [4, 5]],
    ['stopped tab before playing tab', [5, 4]],
  ] as const)('keeps an ineligible playing tab from being erased by a stopped sibling: %s', async (_name, ids) => {
    // Given: exactly one personal Twitch stream is still playing, but it is not farm-eligible.
    const result = await detectManualViewing({
      target,
      managedTabId: null,
      automationActive: true,
      now: 100,
      queryTabs: async () =>
        ids.map((id) => ({
          id,
          active: false,
          url: `https://www.twitch.tv/${id === 4 ? 'playing' : 'stopped'}`,
        })),
      getStreamContext: async (tabId) =>
        tabId === 4
          ? {
              channelName: 'playing',
              categorySlug: 'another-game',
              isLive: true,
              isPlaybackReady: true,
            }
          : {
              channelName: 'stopped',
              categorySlug: 'another-game',
              isLive: true,
              isPlaybackReady: false,
            },
    });

    // When: all personal tabs are inspected in either order.
    // Then: the playing stream still suspends farming.
    expect(result).toEqual({ kind: 'automation-paused', reason: 'ineligible-manual-view' });
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

  test('reports an observation failure when tab detection fails', async () => {
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

    expect(result).toEqual({ kind: 'failed', reason: 'observation-unavailable' });
  });

  test('reports an observation failure when a Twitch tab has no stream context', async () => {
    // Given: a Twitch tab remains open but its content telemetry is unavailable.
    const result = await detectManualViewing({
      target,
      managedTabId: null,
      automationActive: true,
      now: 100,
      queryTabs: async () => [{ id: 4, active: false, url: 'https://www.twitch.tv/missing' }],
      getStreamContext: async () => null,
    });

    // When: manual playback is classified.
    // Then: an unknown tab is never mistaken for a stopped stream.
    expect(result).toEqual({ kind: 'failed', reason: 'observation-unavailable' });
  });

  test('ignores non-Twitch and managed tabs', async () => {
    const result = await detectManualViewing({
      target,
      managedTabId: 1,
      automationActive: true,
      now: 100,
      queryTabs: async () => [
        { id: 1, active: true, url: 'https://www.twitch.tv/managed' },
        { id: 2, active: false, url: 'https://example.com/other' },
        { id: 3, active: true, url: 'https://example.com/' },
        { id: 4, active: true, url: 'https://example.com/missing' },
      ],
      getStreamContext: async () => null,
    });

    expect(result).toEqual({ kind: 'inactive', reason: 'no-recent-visible-twitch' });
  });
});
