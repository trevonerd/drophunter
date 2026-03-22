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
  childSelectors: Set<string>;
  getAttribute(name: string): string | null;
  closest(selector: string): FakeElement | null;
  querySelector(selector: string): FakeElement | null;
  click(): void;
}

function createFakeElement(options: {
  textContent?: string;
  disabled?: boolean;
  hidden?: boolean;
  attributes?: Record<string, string>;
  closestTarget?: FakeElement | null;
  childSelectors?: string[];
} = {}): FakeElement {
  const element: FakeElement = {
    textContent: options.textContent ?? '',
    disabled: options.disabled ?? false,
    hidden: options.hidden ?? false,
    clickCount: 0,
    attributes: options.attributes ?? {},
    closestTarget: options.closestTarget ?? null,
    childSelectors: new Set(options.childSelectors ?? []),
    getAttribute(name: string) {
      return this.attributes[name] ?? null;
    },
    closest() {
      return this.closestTarget;
    },
    querySelector(selector: string) {
      return this.childSelectors.has(selector) ? this : null;
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

  test('claims an enabled button with explicit bonus text', () => {
    const button = createFakeElement({
      attributes: { 'aria-label': 'Claim bonus' },
    });
    const root = createFakeRoot({
      'button[aria-label]': [button],
    });

    expect(claimChannelPointsBonus(root)).toEqual({
      claimed: true,
      reason: 'claimed',
    });
    expect(button.clickCount).toBe(1);
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
      attributes: { 'aria-label': 'Claim bonus' },
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
