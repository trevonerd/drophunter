import {
  createFarmingAutomationBrowser,
  type FarmingAutomationChromeHost,
} from '../../src/background/farming-automation-browser.ts';
import type { WatchOwnershipV1 } from '../../src/background/farming-automation-contracts.ts';
import type { ManualStreamContext } from '../../src/background/manual-watch-detector.ts';
import type { FarmingTarget } from '../../src/background/watch-transport.ts';
import type { PlaybackPrepResult } from '../../src/types/index.ts';

export const incumbent: WatchOwnershipV1 = {
  kind: 'managed-tab',
  tabId: 11,
  ownershipToken: 'incumbent-token',
  expectedChannel: 'channel-a',
};

export const target: FarmingTarget = {
  gameId: 'game-b',
  campaignId: 'campaign-b',
  channelName: 'channel-b',
};

export type HostFixtureOptions = {
  readonly tabUrl?: string;
  readonly windowTabCount?: number;
  readonly manualTabs?: readonly {
    readonly id: number;
    readonly windowId: number;
    readonly url: string;
    readonly active: boolean;
  }[];
};

export function createHost(
  operationLog: string[],
  fixtureOptions: HostFixtureOptions = {},
): FarmingAutomationChromeHost {
  const sessionValues = new Map<string, unknown>();
  const tabUrl = fixtureOptions.tabUrl ?? 'https://www.twitch.tv/channel-b';
  const windowTabCount = fixtureOptions.windowTabCount ?? 2;
  return {
    tabs: {
      create: async (properties) => {
        operationLog.push(`open:${properties.active}:${properties.muted}`);
        return { id: 22, windowId: 4, url: properties.url, active: properties.active };
      },
      get: async () => ({ id: 22, windowId: 4, url: tabUrl, active: false }),
      query: async (query) =>
        query.windowId === undefined
          ? (fixtureOptions.manualTabs ?? [
              { id: 31, windowId: 5, url: 'https://www.twitch.tv/manual-channel', active: false },
            ])
          : Array.from({ length: windowTabCount }, (_, index) => ({
              id: 22 + index,
              windowId: 4,
              url: index === 0 ? tabUrl : 'about:blank',
              active: index !== 0,
            })),
      update: async (tabId, properties) => {
        operationLog.push(`update:${tabId}:${properties.url ?? ''}`);
      },
      remove: async (tabId) => {
        operationLog.push(`remove:${tabId}`);
      },
    },
    sessionStorage: {
      get: async (key) => ({ [key]: sessionValues.get(key) }),
      set: async (values) => {
        for (const [key, value] of Object.entries(values)) sessionValues.set(key, value);
      },
      remove: async (key) => {
        sessionValues.delete(key);
      },
    },
    permissions: { hasNotifications: async () => true },
    notifications: {
      create: async (id) => {
        operationLog.push(`notification:${id}`);
        return 'notification-id';
      },
    },
    alarms: {
      clear: async (name) => {
        operationLog.push(`clear:${name}`);
        return true;
      },
      create: (name, info) => {
        operationLog.push(`alarm:${name}:${info.when ?? info.periodInMinutes}`);
      },
    },
    runtime: { getUrl: (path) => `chrome-extension://test/${path}` },
  };
}

export type AdapterFixtureOptions = {
  readonly currentOwnership?: WatchOwnershipV1 | null;
  readonly getManualStreamContext?: (tabId: number) => Promise<ManualStreamContext | null>;
  readonly playbackPreparation?: PlaybackPrepResult;
};

export function createAdapter(
  host: FarmingAutomationChromeHost,
  operations: string[],
  fixtureOptions: AdapterFixtureOptions = {},
) {
  return createFarmingAutomationBrowser({
    host,
    watch: {
      tablessEnabled: true,
      heartbeat: async () => ({ accepted: true }),
      waitForTabComplete: async (_tabId, timeoutMs) => {
        operations.push(`wait:${timeoutMs}`);
      },
      preparePlayback: async (_tabId, options) => {
        operations.push(`prep:${options.activateTab}:${options.unmuteTab}:${options.muteAfterPrep}`);
        return fixtureOptions.playbackPreparation ?? { isPlaybackReady: true };
      },
      probeManaged: async (_ownership, explicitTarget) => {
        operations.push(`probe:${explicitTarget.campaignId}`);
        return { accepted: true, isLive: true, sameChannel: true, sameGame: true };
      },
    },
    getManualStreamContext: fixtureOptions.getManualStreamContext ?? (async () => null),
    currentOwnership: fixtureOptions.currentOwnership ?? incumbent,
    createOwnershipToken: () => 'candidate-token',
  });
}
