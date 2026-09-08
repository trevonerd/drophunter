import { expect, test } from 'bun:test';
import {
  EXTENSION_VERSION_STORAGE_KEY,
  migrateExtensionStorage,
  STORAGE_SCHEMA_VERSION,
  STORAGE_SCHEMA_VERSION_KEY,
} from '../src/background/storage-migrations.ts';
import { setupChromeMocks } from './mocks/chrome.ts';

test.each([
  ['3.99.0.14', '3.99.0.15'],
  ['3.99.0.15', '3.99.0.14'],
])('preserves queue authorization, stall evidence and settings across %s → %s', async (previousVersion, version) => {
  const mocks = setupChromeMocks();
  try {
    const block = { blockedAt: 1000, rotationAttempts: 3, eligibleStreamerNames: ['channel-a'] };
    await mocks.storage.local.set({
      [STORAGE_SCHEMA_VERSION_KEY]: STORAGE_SCHEMA_VERSION,
      [EXTENSION_VERSION_STORAGE_KEY]: previousVersion,
      appState: {
        manualQueueAuthorized: true,
        farmingSessionOrigin: 'automatic',
        autoStartFavoriteGames: false,
        notificationsEnabled: false,
        watchTransportPreference: 'managed-tab',
        stalledCampaignBlocksByKey: { 'campaign:campaign-a': block },
        campaignPriorityMode: 'lowest-availability',
      },
    });

    await migrateExtensionStorage(version);

    expect(mocks.storage.local._store.get('appState')).toMatchObject({
      manualQueueAuthorized: true,
      farmingSessionOrigin: 'automatic',
      autoStartFavoriteGames: false,
      notificationsEnabled: false,
      watchTransportPreference: 'managed-tab',
      watchTransportMode: 'managed-tab',
      stalledCampaignBlocksByKey: { 'campaign:campaign-a': block },
      campaignPriorityMode: 'ending-soonest',
    });
  } finally {
    mocks.teardown();
  }
});
