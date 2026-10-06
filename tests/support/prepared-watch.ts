import type { WatchOwnershipV1 } from '../../src/background/farming-automation-contracts.ts';
import type { FarmingTarget, WatchHealth } from '../../src/background/watch-transport.ts';
import type { WatchPreparation } from '../../src/background/watch-transport-transition.ts';

export function preparedWatch(target: FarmingTarget, health: WatchHealth): WatchPreparation {
  const ownership: WatchOwnershipV1 =
    health.mode === 'tabless'
      ? { kind: 'tabless', targetKey: target.channelName }
      : { kind: 'managed-tab', tabId: 42, ownershipToken: 'test-watch', expectedChannel: target.channelName };
  return {
    kind: 'prepared',
    watch: {
      target,
      health,
      ownership,
      fallbackReason: null,
      promote: () => ({ kind: 'promoted', ownership, obsolete: null }),
      dispose: async () => {},
    },
  };
}
