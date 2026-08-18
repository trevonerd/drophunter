import { describe, expect, test } from 'bun:test';
import { monitorDashboardUrl, streamerWatchUrl } from '../src/background/tab-management.ts';
import { setupTabManagementMock } from './mocks/tab-management.ts';

describe('streamerWatchUrl', () => {
  test('encodes channel name and builds Twitch URL', () => {
    expect(streamerWatchUrl('TestChannel')).toBe('https://www.twitch.tv/testchannel');
  });

  test('handles special characters in channel name', () => {
    expect(streamerWatchUrl('Channel With Spaces')).toBe('https://www.twitch.tv/channel%20with%20spaces');
  });
});

describe('monitorDashboardUrl', () => {
  test('returns chrome-extension URL for monitor.html', () => {
    const { teardown } = setupTabManagementMock();
    try {
      expect(monitorDashboardUrl()).toMatch(/^chrome-extension:\/\/mock-id\/monitor\.html$/);
    } finally {
      teardown();
    }
  });
});
