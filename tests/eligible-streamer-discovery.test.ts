import { describe, expect, test } from 'bun:test';
import { discoverEligibleStreamers } from '../src/background/eligible-streamer-discovery.ts';
import type { TwitchGame, TwitchStreamer } from '../src/types/index.ts';

const game: TwitchGame = {
  id: 'game-1',
  name: 'Game',
  categoryId: 'category-1',
  categorySlug: 'game',
  imageUrl: '',
  allowedChannels: ['allowed', 'offline', 'wrong-category'],
};

function streamer(name: string, isLive = true): TwitchStreamer {
  return { id: name, name, displayName: name, isLive, viewerCount: 1 };
}

describe('verified eligible streamer discovery', () => {
  test('queries without preferred language when its top results exclude authorized live channels', async () => {
    const languages: string[] = [];
    const result = await discoverEligibleStreamers({
      game,
      language: 'it',
      fetchDirectory: async (_game, language) => {
        languages.push(language);
        return {
          streamers: language ? [streamer('unrelated')] : [streamer('allowed')],
          languageFilterApplied: Boolean(language),
        };
      },
      probeChannel: async () => ({ kind: 'offline' }),
    });

    expect(languages).toEqual(['it', '']);
    expect(result).toMatchObject({ kind: 'ready', streamers: [{ name: 'allowed' }] });
  });

  test('keeps stalled channels excluded across preferred-language fallback', async () => {
    const languages: string[] = [];
    const result = await discoverEligibleStreamers({
      game: { ...game, allowedChannels: [] },
      language: 'it',
      fetchDirectory: async (_game, language) => {
        languages.push(language);
        return {
          streamers: language ? [streamer('A')] : [streamer('A'), streamer('B')],
          languageFilterApplied: Boolean(language),
        };
      },
      probeChannel: async () => ({ kind: 'offline' }),
      excludedStreamerNames: [' a '],
    });

    expect(languages).toEqual(['it', '']);
    expect(result).toMatchObject({ kind: 'ready', streamers: [{ name: 'B' }] });
  });

  test('finds authorized channels missing from the directory top 30 by probing StreamInfo', async () => {
    const probed: string[] = [];
    const result = await discoverEligibleStreamers({
      game: { ...game, allowedChannels: ['outside-top-30'] },
      language: '',
      fetchDirectory: async () => ({ streamers: [], languageFilterApplied: false }),
      probeChannel: async (channel) => {
        probed.push(channel);
        return { kind: 'live', streamer: streamer(channel), categoryId: 'category-1' };
      },
    });

    expect(probed).toEqual(['outside-top-30']);
    expect(result).toMatchObject({ kind: 'ready', streamers: [{ name: 'outside-top-30' }] });
  });

  test('returns verified empty only when every authorized channel was checked', async () => {
    const result = await discoverEligibleStreamers({
      game,
      language: '',
      fetchDirectory: async () => ({ streamers: [], languageFilterApplied: false }),
      probeChannel: async (channel) =>
        channel === 'wrong-category'
          ? { kind: 'live', streamer: streamer(channel), categoryId: 'other-category' }
          : { kind: 'offline' },
    });

    expect(result).toEqual({ kind: 'empty', game });
  });

  test('does not return verified empty when any StreamInfo verification is unavailable', async () => {
    let refreshed = 0;
    const result = await discoverEligibleStreamers({
      game,
      language: '',
      fetchDirectory: async () => ({ streamers: [], languageFilterApplied: false }),
      probeChannel: async (channel) =>
        channel === 'allowed' ? { kind: 'unavailable' } : { kind: 'offline' },
      refresh: async () => {
        refreshed += 1;
        return { kind: 'unavailable' };
      },
    });

    expect(refreshed).toBe(1);
    expect(result.kind).toBe('unavailable');
  });

  test('repeats discovery with channels from one fresh campaign snapshot', async () => {
    const calls: string[] = [];
    const result = await discoverEligibleStreamers({
      game: { ...game, allowedChannels: [] },
      language: '',
      fetchDirectory: async (candidate) => {
        calls.push(candidate.allowedChannels?.join(',') ?? 'any');
        return candidate.allowedChannels?.length
          ? { streamers: [], languageFilterApplied: false }
          : { streamers: [], languageFilterApplied: false };
      },
      probeChannel: async () => ({ kind: 'offline' }),
      refresh: async () => ({ kind: 'ready', game: { ...game, allowedChannels: ['allowed'] } }),
    });

    expect(calls).toEqual(['', 'allowed']);
    expect(result).toEqual({ kind: 'empty', game: { ...game, allowedChannels: ['allowed'] } });
  });

  test('awaits probes and cancels stale work without returning empty', async () => {
    let current = true;
    let probes = 0;
    const result = await discoverEligibleStreamers({
      game,
      language: '',
      isCurrent: () => current,
      fetchDirectory: async () => ({ streamers: [], languageFilterApplied: false }),
      probeChannel: async () => {
        probes += 1;
        current = false;
        return { kind: 'offline' };
      },
    });

    expect(probes).toBe(3);
    expect(result.kind).toBe('cancelled');
  });
});
