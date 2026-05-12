import { describe, expect, test } from 'bun:test';
import {
  applyAutoClaimChannelPointsBonusSetting,
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

function createFakeElement(options: {
  textContent?: string;
  disabled?: boolean;
  hidden?: boolean;
  attributes?: Record<string, string>;
  closestTarget?: FakeElement | null;
} = {}): FakeElement {
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
