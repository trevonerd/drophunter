import { describe, expect, test } from 'bun:test';
import {
  applyPreferredStreamerLanguageSetting,
  applyStreamerSelectionModeSetting,
  normalizePreferredStreamerLanguage,
  pickStreamerForPreferences,
} from '../src/background/streamer-selection.ts';
import { createInitialState } from '../src/shared/utils.ts';
import type { TwitchStreamer } from '../src/types/index.ts';

function makeStreamer(
  name: string,
  viewerCount?: number,
  broadcasterLanguage?: string,
): TwitchStreamer {
  return {
    id: name,
    name,
    displayName: name,
    isLive: true,
    viewerCount,
    broadcasterLanguage,
  };
}

describe('streamer selection settings', () => {
  test('mode setting falls back safely to low-view', () => {
    expect(applyStreamerSelectionModeSetting(createInitialState(), 'random').streamerSelectionMode).toBe(
      'random',
    );
    expect(
      applyStreamerSelectionModeSetting(createInitialState(), undefined).streamerSelectionMode,
    ).toBe('low-view');
  });

  test('preferred language setting normalizes locale-like values', () => {
    expect(normalizePreferredStreamerLanguage('IT-it')).toBe('it');
    expect(normalizePreferredStreamerLanguage('')).toBeNull();
    expect(
      applyPreferredStreamerLanguageSetting(createInitialState(), 'EN_gb').preferredStreamerLanguage,
    ).toBe('en');
  });
});

describe('pickStreamerForPreferences', () => {
  test('low-view selects only from the low-view bucket', () => {
    const streamers = [
      makeStreamer('a', 10),
      makeStreamer('b', 20),
      makeStreamer('c', 30),
      makeStreamer('d', 40),
      makeStreamer('e', 50),
      makeStreamer('f', 60),
      makeStreamer('g', 70),
      makeStreamer('h', 80),
      makeStreamer('i', 90),
      makeStreamer('j', 100),
    ];

    const result = pickStreamerForPreferences(
      streamers,
      { mode: 'low-view', preferredLanguage: null },
      () => 0.99,
    );

    expect(['a', 'b', 'c']).toContain(result.streamer?.name);
    expect(result.activePoolSize).toBe(streamers.length);
  });

  test('random can select from the full eligible pool including unknown counts', () => {
    const streamers = [makeStreamer('a', 10), makeStreamer('b'), makeStreamer('c', 30)];
    const result = pickStreamerForPreferences(
      streamers,
      { mode: 'random', preferredLanguage: null },
      () => 0.5,
    );

    expect(result.streamer?.name).toBe('b');
  });

  test('top-viewers selects the highest-view candidate', () => {
    const streamers = [makeStreamer('a', 10), makeStreamer('b', 80), makeStreamer('c', 30)];
    const result = pickStreamerForPreferences(streamers, {
      mode: 'top-viewers',
      preferredLanguage: null,
    });

    expect(result.streamer?.name).toBe('b');
  });

  test('preferred language narrows the pool when matches exist', () => {
    const streamers = [
      makeStreamer('a', 10, 'en'),
      makeStreamer('b', 20, 'it'),
      makeStreamer('c', 30, 'it'),
    ];
    const result = pickStreamerForPreferences(
      streamers,
      { mode: 'top-viewers', preferredLanguage: 'it' },
      () => 0,
    );

    expect(result.preferredLanguageApplied).toBe(true);
    expect(result.preferredLanguageMatches).toBe(2);
    expect(result.streamer?.name).toBe('c');
  });

  test('preferred language falls back cleanly when there are no matches', () => {
    const streamers = [makeStreamer('a', 10, 'en'), makeStreamer('b', 20, 'fr')];
    const result = pickStreamerForPreferences(streamers, {
      mode: 'top-viewers',
      preferredLanguage: 'it',
    });

    expect(result.preferredLanguageApplied).toBe(false);
    expect(result.preferredLanguageMatches).toBe(0);
    expect(result.streamer?.name).toBe('b');
  });
});

describe('pickStreamerForPreferences with serverLanguageFilterApplied', () => {
  test('skips client-side language filter when serverLanguageFilterApplied is true', () => {
    const streamers = [
      makeStreamer('a', 10, 'en'),
      makeStreamer('b', 20, 'it'),
      makeStreamer('c', 30, 'fr'),
    ];
    const result = pickStreamerForPreferences(
      streamers,
      { mode: 'top-viewers', preferredLanguage: 'it' },
      () => 0,
      true,
    );
    expect(result.streamer?.name).toBe('c');
    expect(result.preferredLanguageApplied).toBe(false);
  });

  test('applies client-side language filter when serverLanguageFilterApplied is false', () => {
    const streamers = [
      makeStreamer('a', 10, 'en'),
      makeStreamer('b', 20, 'it'),
      makeStreamer('c', 30, 'it'),
    ];
    const result = pickStreamerForPreferences(
      streamers,
      { mode: 'top-viewers', preferredLanguage: 'it' },
      () => 0,
      false,
    );
    expect(result.preferredLanguageApplied).toBe(true);
    expect(result.streamer?.name).toBe('c');
  });

  test('applies client-side language filter when serverLanguageFilterApplied is undefined (backward compat)', () => {
    const streamers = [
      makeStreamer('a', 10, 'en'),
      makeStreamer('b', 30, 'it'),
    ];
    const result = pickStreamerForPreferences(
      streamers,
      { mode: 'top-viewers', preferredLanguage: 'it' },
      () => 0,
      undefined,
    );
    expect(result.preferredLanguageApplied).toBe(true);
    expect(result.streamer?.name).toBe('b');
  });
});
