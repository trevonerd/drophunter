import { describe, expect, test } from 'bun:test';
import { getFarmableTwitchChannelNameFromUrl } from '../src/shared/twitch-url.ts';

describe('getFarmableTwitchChannelNameFromUrl', () => {
  test('extracts a lowercase channel name from a standard Twitch channel URL', () => {
    expect(getFarmableTwitchChannelNameFromUrl('https://www.twitch.tv/TrevoNerd')).toBe('trevonerd');
  });

  test('extracts the player channel query param for embed URLs', () => {
    expect(getFarmableTwitchChannelNameFromUrl('https://player.twitch.tv/?channel=DropHunterLive')).toBe(
      'drophunterlive',
    );
  });

  test('returns null for reserved Twitch routes that are not farmable channels', () => {
    expect(getFarmableTwitchChannelNameFromUrl('https://www.twitch.tv/drops/campaigns')).toBeNull();
    expect(
      getFarmableTwitchChannelNameFromUrl('https://www.twitch.tv/directory/category/valorant'),
    ).toBeNull();
  });

  test('returns null for non-Twitch URLs and invalid input', () => {
    expect(getFarmableTwitchChannelNameFromUrl('https://example.com/trevonerd')).toBeNull();
    expect(getFarmableTwitchChannelNameFromUrl('not-a-url')).toBeNull();
    expect(getFarmableTwitchChannelNameFromUrl(undefined)).toBeNull();
  });
});
