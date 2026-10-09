import { browser } from '../shared/browser-api.ts';
import { TWITCH_MATCHES } from '../shared/extension-manifest.ts';
import type { ServiceWorkerState } from './runtime-state.ts';
import { broadcastStateUpdate, saveState } from './state-persistence.ts';
import { withStateStorageTransaction } from './state-storage-transaction.ts';

type ContentScript = Parameters<typeof browser.scripting.registerContentScripts>[0][number];

const registration: ContentScript = {
  id: 'drophunter-twitch-adblock',
  js: ['twitch-adblock.js'],
  matches: [...TWITCH_MATCHES],
  world: 'MAIN',
  runAt: 'document_start',
  allFrames: true,
  persistAcrossSessions: true,
};

async function readRegistration(): Promise<ContentScript | undefined> {
  return (await browser.scripting.getRegisteredContentScripts({ ids: [registration.id] }))[0];
}

async function applyRegistration(current: ContentScript | undefined, target: ContentScript | undefined) {
  if (!target) {
    if (current) await browser.scripting.unregisterContentScripts({ ids: [registration.id] });
  } else if (!current) {
    await browser.scripting.registerContentScripts([target]);
  } else if (
    !Object.entries(target).every(
      ([key, value]) => JSON.stringify(current[key as keyof ContentScript]) === JSON.stringify(value),
    )
  ) {
    await browser.scripting.updateContentScripts([target]);
  }
}

export function createTwitchAdblockController(state: ServiceWorkerState) {
  function commit<T>(enabled: boolean | (() => boolean), operation: () => Promise<T>): Promise<T> {
    return withStateStorageTransaction(state, async () => {
      const previous = await readRegistration();
      try {
        const targetEnabled = typeof enabled === 'boolean' ? enabled : enabled();
        await applyRegistration(previous, targetEnabled ? registration : undefined);
        return await operation();
      } catch (error) {
        try {
          await applyRegistration(await readRegistration(), previous);
        } catch (rollbackError) {
          throw new Error(
            `${String(error)}; could not restore Twitch adblock registration: ${String(rollbackError)}`,
          );
        }
        throw error;
      }
    });
  }

  return {
    commit,
    recordBlockedAds: async (count: number, senderUrl?: string) => {
      let url: URL;
      try {
        url = new URL(senderUrl ?? '');
      } catch {
        return { success: false };
      }
      if (url.protocol !== 'https:' || !(url.hostname === 'twitch.tv' || url.hostname.endsWith('.twitch.tv')))
        return { success: false };
      await saveState(state, {
        updateAppState: (appState) => ({
          ...appState,
          totalTwitchAdsBlocked: Math.min(Number.MAX_SAFE_INTEGER, appState.totalTwitchAdsBlocked + count),
        }),
      });
      return { success: true };
    },
    reconcile: async () => {
      const previous = state.appState.twitchAdblockUnavailable;
      try {
        await commit(
          () => state.appState.twitchAdblockEnabled,
          async () => undefined,
        );
        state.appState.twitchAdblockUnavailable = false;
      } catch (error) {
        state.appState.twitchAdblockUnavailable = true;
        throw error;
      } finally {
        if (state.appState.twitchAdblockUnavailable !== previous) broadcastStateUpdate(state.appState);
      }
    },
    setEnabled: async (enabled: boolean) => {
      await state.backupImportCompletion;
      await commit(enabled, async () => {
        const appState = {
          ...state.appState,
          twitchAdblockEnabled: enabled,
          twitchAdblockUnavailable: false,
        };
        await browser.storage.local.set({ appState });
        state.appState.twitchAdblockEnabled = enabled;
        state.appState.twitchAdblockUnavailable = false;
        broadcastStateUpdate(state.appState);
      });
      return { success: true, twitchAdblockEnabled: state.appState.twitchAdblockEnabled };
    },
  };
}
