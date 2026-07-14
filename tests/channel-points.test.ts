import { describe, expect, test } from 'bun:test';
import {
  applyAutoClaimChannelPointsBonusSetting,
  attemptAutoClaimChannelPointsBonusExt,
  type ChannelPointsClaimDeps,
  type ChannelPointsRecordingDeps,
  recordChannelPointsBonusClaimedExt,
  shouldAttemptAutoClaimChannelPointsBonus,
} from '../src/background/channel-points.ts';
import {
  claimChannelPointsBonus,
  findClaimableChannelPointsBonusButton,
} from '../src/content/channel-points.ts';
import { createInitialState } from '../src/shared/utils.ts';

interface FakeElement {
  textContent?: string | null;
  disabled?: boolean;
  hidden?: boolean;
  clickCount: number;
  attributes: Record<string, string>;
  closestTarget: FakeElement | null;
  getAttribute(name: string): string | null;
  closest(selector: string): FakeElement | null;
  click(): void;
}

function createFakeElement(
  options: {
    textContent?: string;
    disabled?: boolean;
    hidden?: boolean;
    attributes?: Record<string, string>;
    closestTarget?: FakeElement | null;
  } = {},
): FakeElement {
  const element: FakeElement = {
    textContent: options.textContent ?? '',
    disabled: options.disabled ?? false,
    hidden: options.hidden ?? false,
    clickCount: 0,
    attributes: options.attributes ?? {},
    closestTarget: options.closestTarget ?? null,
    getAttribute(name: string) {
      return this.attributes[name] ?? null;
    },
    closest() {
      return this.closestTarget;
    },
    click() {
      this.clickCount += 1;
    },
  };

  return element;
}

function createFakeRoot(map: Record<string, FakeElement[]>) {
  return {
    querySelectorAll(selector: string) {
      return map[selector] ?? [];
    },
  };
}

describe('background channel-points settings', () => {
  test('enabling the setting updates app state', () => {
    const next = applyAutoClaimChannelPointsBonusSetting(createInitialState(), true);
    expect(next.autoClaimChannelPointsBonus).toBe(true);
  });

  test('disabling the setting updates app state', () => {
    const next = applyAutoClaimChannelPointsBonusSetting(
      {
        ...createInitialState(),
        autoClaimChannelPointsBonus: true,
      },
      false,
    );
    expect(next.autoClaimChannelPointsBonus).toBe(false);
  });

  test('claim gate blocks attempts when idle, paused, or disabled', () => {
    expect(shouldAttemptAutoClaimChannelPointsBonus(createInitialState())).toBe(false);
    expect(
      shouldAttemptAutoClaimChannelPointsBonus({
        ...createInitialState(),
        isRunning: true,
        isPaused: true,
        autoClaimChannelPointsBonus: true,
        tabId: 12,
      }),
    ).toBe(false);
    expect(
      shouldAttemptAutoClaimChannelPointsBonus({
        ...createInitialState(),
        isRunning: true,
        autoClaimChannelPointsBonus: false,
        tabId: 12,
      }),
    ).toBe(false);
  });

  test('claim gate allows attempts only while farming an active managed tab', () => {
    expect(
      shouldAttemptAutoClaimChannelPointsBonus({
        ...createInitialState(),
        isRunning: true,
        autoClaimChannelPointsBonus: true,
        tabId: 12,
      }),
    ).toBe(true);
  });

  test('totalChannelPointsClaimed starts at 0 in initial state', () => {
    expect(createInitialState().totalChannelPointsClaimed).toBe(0);
  });

  test('totalChannelPointsClaimed increments correctly', () => {
    const state = createInitialState();
    state.totalChannelPointsClaimed += 1;
    expect(state.totalChannelPointsClaimed).toBe(1);
    state.totalChannelPointsClaimed += 1;
    expect(state.totalChannelPointsClaimed).toBe(2);
  });

  test('totalChannelPointsClaimed is independent from totalDropsClaimed', () => {
    const state = { ...createInitialState(), totalDropsClaimed: 5 };
    state.totalChannelPointsClaimed += 1;
    expect(state.totalChannelPointsClaimed).toBe(1);
    expect(state.totalDropsClaimed).toBe(5);
  });
});

describe('content channel-points bonus detection', () => {
  test('returns the explicit bonus button when a claimable bonus icon is present', () => {
    const button = createFakeElement({
      attributes: { 'aria-label': 'Channel points' },
    });
    const icon = createFakeElement({
      attributes: { 'data-test-selector': 'claimable-bonus__icon' },
      closestTarget: button,
    });
    const root = createFakeRoot({
      '[data-test-selector*="claimable-bonus"]': [icon],
    });

    expect(findClaimableChannelPointsBonusButton(root)).toBe(button);
  });

  test('claims the May 2026 Twitch bonus icon shape with an Italian label', () => {
    const button = createFakeElement({
      attributes: { 'aria-label': 'Riscatta bonus' },
    });
    const icon = createFakeElement({
      attributes: { class: 'Layout-sc-1xcs6mc-0 fHdBNk claimable-bonus__icon' },
      closestTarget: button,
    });
    const root = createFakeRoot({
      '.claimable-bonus__icon': [icon],
    });

    expect(claimChannelPointsBonus(root)).toEqual({
      claimed: true,
      reason: 'claimed',
    });
    expect(button.clickCount).toBe(1);
  });

  test('claims a structurally matched bonus with an unknown localized label', () => {
    const button = createFakeElement({
      attributes: { 'aria-label': 'ボーナスを受け取る' },
    });
    const icon = createFakeElement({
      attributes: { class: 'claimable-bonus__icon' },
      closestTarget: button,
    });
    const root = createFakeRoot({
      '.claimable-bonus__icon': [icon],
    });

    expect(claimChannelPointsBonus(root)).toEqual({
      claimed: true,
      reason: 'claimed',
    });
    expect(button.clickCount).toBe(1);
  });

  test('ignores text-only bonus labels without the Twitch bonus icon', () => {
    const button = createFakeElement({
      attributes: { 'aria-label': 'Riscatta bonus' },
    });
    const root = createFakeRoot({
      'button[aria-label]': [button],
    });

    expect(claimChannelPointsBonus(root)).toEqual({
      claimed: false,
      reason: 'not-available',
    });
    expect(button.clickCount).toBe(0);
  });

  test('ignores the community points balance button', () => {
    const button = createFakeElement({
      attributes: { 'aria-label': 'Saldo punti e bit' },
    });
    const root = createFakeRoot({
      'button[aria-label]': [button],
    });

    expect(claimChannelPointsBonus(root)).toEqual({
      claimed: false,
      reason: 'not-available',
    });
    expect(button.clickCount).toBe(0);
  });

  test('returns not-available when no claimable bonus exists', () => {
    const root = createFakeRoot({});
    expect(claimChannelPointsBonus(root)).toEqual({
      claimed: false,
      reason: 'not-available',
    });
  });

  test('ignores disabled bonus buttons', () => {
    const button = createFakeElement({
      disabled: true,
    });
    const icon = createFakeElement({ closestTarget: button });
    const root = createFakeRoot({
      '.claimable-bonus__icon': [icon],
    });

    expect(claimChannelPointsBonus(root)).toEqual({
      claimed: false,
      reason: 'not-available',
    });
    expect(button.clickCount).toBe(0);
  });

  test('ignores reward redemption buttons that are not the free bonus', () => {
    const button = createFakeElement({
      attributes: { 'aria-label': 'Redeem reward with channel points' },
    });
    const root = createFakeRoot({
      'button[aria-label]': [button],
    });

    expect(claimChannelPointsBonus(root)).toEqual({
      claimed: false,
      reason: 'not-available',
    });
    expect(button.clickCount).toBe(0);
  });

  test('returns not-supported-page when the page is not a farmable channel page', () => {
    const root = createFakeRoot({});
    expect(claimChannelPointsBonus(root, { supportedPage: false })).toEqual({
      claimed: false,
      reason: 'not-supported-page',
    });
  });
});

describe('content channel-points autonomous claiming', () => {
  test('returns not-supported-page when supportedPage is false', () => {
    const button = createFakeElement();
    const root = createFakeRoot({
      '.claimable-bonus__icon': [createFakeElement({ closestTarget: button })],
    });

    expect(claimChannelPointsBonus(root, { supportedPage: false })).toEqual({
      claimed: false,
      reason: 'not-supported-page',
    });
  });

  test('claims a bonus button when supportedPage is true', () => {
    const button = createFakeElement();
    const root = createFakeRoot({
      '.claimable-bonus__icon': [createFakeElement({ closestTarget: button })],
    });

    expect(claimChannelPointsBonus(root, { supportedPage: true })).toEqual({
      claimed: true,
      reason: 'claimed',
    });
    expect(button.clickCount).toBe(1);
  });
});

describe('attemptAutoClaimChannelPointsBonusExt', () => {
  function makeRunningState() {
    return {
      ...createInitialState(),
      isRunning: true,
      isPaused: false,
      autoClaimChannelPointsBonus: true,
      tabId: 42,
      activeStreamer: { displayName: 'StreamerName' },
    };
  }

  test('returns false and short-circuits when not eligible (idle)', async () => {
    const state = createInitialState();
    let ensureContentScriptCalled = false;
    const deps: ChannelPointsClaimDeps = {
      ensureContentScriptOnTab: () => {
        ensureContentScriptCalled = true;
      },
      sendMessageToTab: async () => null,
      getTab: async () => ({ id: 42 }),
      recordBonusClaimed: async () => undefined,
    };
    expect(await attemptAutoClaimChannelPointsBonusExt(state, deps)).toBe(false);
    expect(ensureContentScriptCalled).toBe(false);
  });

  test('returns false when no tabId', async () => {
    const state = { ...makeRunningState(), tabId: null as unknown as number };
    let getTabCalled = false;
    const deps: ChannelPointsClaimDeps = {
      ensureContentScriptOnTab: () => undefined,
      sendMessageToTab: async () => null,
      getTab: async () => {
        getTabCalled = true;
        return null;
      },
      recordBonusClaimed: async () => undefined,
    };
    expect(await attemptAutoClaimChannelPointsBonusExt(state, deps)).toBe(false);
    expect(getTabCalled).toBe(false);
  });

  test('returns false when tab is missing', async () => {
    const state = makeRunningState();
    let ensureContentScriptCalled = false;
    const deps: ChannelPointsClaimDeps = {
      ensureContentScriptOnTab: () => {
        ensureContentScriptCalled = true;
      },
      sendMessageToTab: async () => null,
      getTab: async () => null,
      recordBonusClaimed: async () => undefined,
    };
    expect(await attemptAutoClaimChannelPointsBonusExt(state, deps)).toBe(false);
    expect(ensureContentScriptCalled).toBe(false);
  });

  test('returns false when content script message returns not-claimed', async () => {
    const state = makeRunningState();
    const ensureContentScriptCalls: number[] = [];
    const deps: ChannelPointsClaimDeps = {
      ensureContentScriptOnTab: (tabId: number) => {
        ensureContentScriptCalls.push(tabId);
      },
      sendMessageToTab: async () => ({ success: true, claimed: false, reason: 'not-available' }),
      getTab: async () => ({ id: 42, url: 'https://www.twitch.tv/StreamerName' }),
      recordBonusClaimed: async () => undefined,
    };
    expect(await attemptAutoClaimChannelPointsBonusExt(state, deps)).toBe(false);
    expect(ensureContentScriptCalls).toEqual([42]);
  });

  test('claims, extracts channel name from URL, and records when result is claimed', async () => {
    const state = makeRunningState();
    const sendMessageCalls: { tabId: number; message: unknown }[] = [];
    const recordedNames: (string | null)[] = [];
    const deps: ChannelPointsClaimDeps = {
      ensureContentScriptOnTab: () => undefined,
      sendMessageToTab: async (tabId, message) => {
        sendMessageCalls.push({ tabId, message });
        return { success: true, claimed: true, reason: 'claimed' };
      },
      getTab: async () => ({ id: 42, url: 'https://www.twitch.tv/SomeChannelXYZ' }),
      recordBonusClaimed: async (channelName) => {
        recordedNames.push(channelName);
      },
    };
    expect(await attemptAutoClaimChannelPointsBonusExt(state, deps)).toBe(true);
    expect(sendMessageCalls).toEqual([{ tabId: 42, message: { type: 'CLAIM_CHANNEL_POINTS_BONUS' } }]);
    expect(recordedNames).toEqual(['somechannelxyz']);
  });

  test('falls back to activeStreamer.displayName when URL has no channel slug', async () => {
    const state = makeRunningState();
    const recordedNames: (string | null)[] = [];
    const deps: ChannelPointsClaimDeps = {
      ensureContentScriptOnTab: () => undefined,
      sendMessageToTab: async () => ({ success: true, claimed: true }),
      getTab: async () => ({ id: 42, url: 'https://dashboard.example.com/' }),
      recordBonusClaimed: async (channelName) => {
        recordedNames.push(channelName);
      },
    };
    expect(await attemptAutoClaimChannelPointsBonusExt(state, deps)).toBe(true);
    expect(recordedNames).toEqual(['StreamerName']);
  });
});

describe('recordChannelPointsBonusClaimedExt', () => {
  test('awaits init, increments counter, persists, and notifies with channel suffix', async () => {
    const state = createInitialState();
    let initAwaited = false;
    const saveCalls: unknown[] = [];
    const notifyCalls: { title: string; message: string; priority?: number }[] = [];
    const deps: ChannelPointsRecordingDeps = {
      awaitInit: async () => {
        initAwaited = true;
      },
      saveState: async () => {
        saveCalls.push(null);
      },
      notify: (title, message, priority) => {
        notifyCalls.push({ title, message, priority });
      },
    };
    await recordChannelPointsBonusClaimedExt(state, deps, 'FromChannel');
    expect(initAwaited).toBe(true);
    expect(state.totalChannelPointsClaimed).toBe(1);
    expect(saveCalls).toHaveLength(1);
    expect(notifyCalls).toEqual([
      { title: 'Channel points claimed', message: 'Claimed from FromChannel.', priority: 0 },
    ]);
  });

  test('notifies without channel suffix when channelName is null or omittedit', async () => {
    const state = { ...createInitialState(), totalChannelPointsClaimed: 12 };
    const notifyCalls: { title: string; message: string; priority?: number }[] = [];
    const deps: ChannelPointsRecordingDeps = {
      awaitInit: async () => undefined,
      saveState: async () => undefined,
      notify: (title, message, priority) => {
        notifyCalls.push({ title, message, priority });
      },
    };
    await recordChannelPointsBonusClaimedExt(state, deps, null);
    await recordChannelPointsBonusClaimedExt(state, deps);
    expect(state.totalChannelPointsClaimed).toBe(14);
    expect(notifyCalls).toEqual([
      { title: 'Channel points claimed', message: 'Claimed.', priority: 0 },
      { title: 'Channel points claimed', message: 'Claimed.', priority: 0 },
    ]);
  });
});
