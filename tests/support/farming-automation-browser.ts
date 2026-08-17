import type { FarmingTarget, WatchProbeResult } from '../../src/background/watch-transport.ts';
import type { ExecutionBarrier } from './farming-automation-fixtures.ts';
import { cloneFixture, createExecutionBarrier } from './farming-automation-fixtures.ts';

export interface InMemoryManagedTabSession {
  readonly owner: 'drophunter';
  readonly tabId: number;
  readonly active: false;
  readonly focused: false;
  readonly muted: true;
  readonly target: FarmingTarget;
}

export interface InMemoryTab {
  readonly id: number;
  readonly url: string;
  readonly active: false;
  readonly focused: false;
  readonly muted: true;
  readonly owner: 'drophunter';
  readonly windowId: number;
}

export type BrowserOperation =
  | { readonly kind: 'open'; readonly tabId: number; readonly target: FarmingTarget }
  | { readonly kind: 'probe'; readonly tabId: number; readonly target: FarmingTarget }
  | { readonly kind: 'close'; readonly tabId: number }
  | { readonly kind: 'notify'; readonly message: string }
  | { readonly kind: 'alarm'; readonly name: string; readonly when: number };

export interface FarmingAutomationBrowserOptions {
  readonly notificationPermission?: boolean;
  readonly probeResult?: WatchProbeResult;
}

export interface FarmingAutomationBrowser {
  readonly tabs: readonly InMemoryTab[];
  readonly operations: readonly BrowserOperation[];
  readonly failures: readonly BrowserFailureRecord[];
  readonly activeProbeCount: number;
  readonly openManagedTab: (target: FarmingTarget) => Promise<InMemoryManagedTabSession>;
  readonly probe: (session: InMemoryManagedTabSession, target: FarmingTarget) => Promise<WatchProbeResult>;
  readonly close: (session: InMemoryManagedTabSession) => Promise<void>;
  readonly hasNotificationPermission: () => Promise<boolean>;
  readonly notify: (message: string) => Promise<void>;
  readonly scheduleAlarm: (name: string, when: number) => Promise<void>;
  readonly blockNextProbe: () => BrowserProbeBarrier;
  readonly failNext: (operation: 'open' | 'probe' | 'close', error: Error) => void;
  readonly setProbeResult: (result: WatchProbeResult) => void;
  readonly setNotificationPermission: (allowed: boolean) => void;
}

export interface BrowserFailureRecord {
  readonly operation: 'open' | 'probe' | 'close';
  readonly message: string;
}

export interface BrowserProbeBarrier extends Omit<ExecutionBarrier<WatchProbeResult>, 'release'> {
  readonly release: (value?: WatchProbeResult) => void;
}

const defaultProbe: WatchProbeResult = {
  accepted: true,
  isLive: true,
  sameChannel: true,
  sameGame: true,
  hasDropsSignal: true,
};

export function createFarmingAutomationBrowser(
  options: FarmingAutomationBrowserOptions = {},
): FarmingAutomationBrowser {
  let nextTabId = 1;
  let currentTabs: InMemoryTab[] = [];
  let currentOperations: BrowserOperation[] = [];
  let probeResult = cloneFixture(options.probeResult ?? defaultProbe);
  let notificationPermission = options.notificationPermission ?? true;
  let activeProbeCount = 0;
  let probeBarrier: ExecutionBarrier<WatchProbeResult> | null = null;
  const failures = new Map<'open' | 'probe' | 'close', Error>();
  let failureRecords: BrowserFailureRecord[] = [];

  const adapter: FarmingAutomationBrowser = {
    get tabs() {
      return cloneFixture(currentTabs);
    },
    get operations() {
      return cloneFixture(currentOperations);
    },
    get failures() {
      return cloneFixture(failureRecords);
    },
    get activeProbeCount() {
      return activeProbeCount;
    },
    async openManagedTab(target) {
      const failure = failures.get('open');
      if (failure) {
        failures.delete('open');
        failureRecords = [...failureRecords, { operation: 'open', message: failure.message }];
        throw failure;
      }
      const tabId = nextTabId;
      nextTabId += 1;
      const tab: InMemoryTab = {
        id: tabId,
        url: `https://www.twitch.tv/${target.channelName}`,
        active: false,
        focused: false,
        muted: true,
        owner: 'drophunter',
        windowId: 1,
      };
      currentTabs = [...currentTabs, tab];
      currentOperations = [...currentOperations, { kind: 'open', tabId, target: cloneFixture(target) }];
      return {
        owner: 'drophunter',
        tabId,
        active: false,
        focused: false,
        muted: true,
        target: cloneFixture(target),
      };
    },
    async probe(session, target) {
      const failure = failures.get('probe');
      if (failure) {
        failures.delete('probe');
        failureRecords = [...failureRecords, { operation: 'probe', message: failure.message }];
        throw failure;
      }
      activeProbeCount += 1;
      currentOperations = [
        ...currentOperations,
        { kind: 'probe', tabId: session.tabId, target: cloneFixture(target) },
      ];
      try {
        if (probeBarrier) {
          const barrier = probeBarrier;
          probeBarrier = null;
          barrier.markStarted();
          return await barrier.promise;
        }
        return cloneFixture(probeResult);
      } finally {
        activeProbeCount -= 1;
      }
    },
    async close(session) {
      const failure = failures.get('close');
      if (failure) {
        failures.delete('close');
        failureRecords = [...failureRecords, { operation: 'close', message: failure.message }];
        throw failure;
      }
      currentTabs = currentTabs.filter((tab) => tab.id !== session.tabId);
      currentOperations = [...currentOperations, { kind: 'close', tabId: session.tabId }];
    },
    async hasNotificationPermission() {
      return notificationPermission;
    },
    async notify(message) {
      currentOperations = [...currentOperations, { kind: 'notify', message }];
    },
    async scheduleAlarm(name, when) {
      currentOperations = [...currentOperations, { kind: 'alarm', name, when }];
    },
    blockNextProbe() {
      const barrier = createExecutionBarrier<WatchProbeResult>();
      probeBarrier = barrier;
      return {
        ...barrier,
        release: (value = cloneFixture(probeResult)) => barrier.release(value),
      };
    },
    failNext(operation, error) {
      failures.set(operation, error);
    },
    setProbeResult(result) {
      probeResult = cloneFixture(result);
    },
    setNotificationPermission(allowed) {
      notificationPermission = allowed;
    },
  };
  return adapter;
}
