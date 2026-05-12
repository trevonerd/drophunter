export type ChannelPointsClaimReason = 'claimed' | 'not-available' | 'not-supported-page';

export interface ChannelPointsClaimResult {
  claimed: boolean;
  reason: ChannelPointsClaimReason;
}

interface ClickableLike {
  disabled?: boolean;
  hidden?: boolean;
  click?: () => void;
  closest?: (selector: string) => ClickableLike | null;
  getAttribute: (name: string) => string | null;
}

interface QueryRootLike {
  querySelectorAll: (selector: string) => ArrayLike<ClickableLike> | Iterable<ClickableLike>;
}

const CLAIMABLE_BONUS_ICON_SELECTORS = [
  '.claimable-bonus__icon',
  '[class*="claimable-bonus__icon"]',
  '[data-test-selector*="claimable-bonus"]',
];

function toArray<T>(value: ArrayLike<T> | Iterable<T>): T[] {
  return Array.from(value);
}

function hasAttribute(element: ClickableLike, name: string): boolean {
  return element.getAttribute(name) !== null;
}

function isHidden(element: ClickableLike): boolean {
  return (
    Boolean(element.hidden) ||
    hasAttribute(element, 'hidden') ||
    element.getAttribute('aria-hidden') === 'true'
  );
}

function isDisabled(element: ClickableLike): boolean {
  return (
    Boolean(element.disabled) ||
    hasAttribute(element, 'disabled') ||
    element.getAttribute('aria-disabled') === 'true'
  );
}

function resolveClickableTarget(icon: ClickableLike): ClickableLike {
  return icon.closest?.('button, [role="button"]') ?? icon;
}

export function findClaimableChannelPointsBonusButton(root: QueryRootLike): ClickableLike | null {
  const seen = new Set<ClickableLike>();

  for (const selector of CLAIMABLE_BONUS_ICON_SELECTORS) {
    for (const icon of toArray(root.querySelectorAll(selector))) {
      const target = resolveClickableTarget(icon);
      if (seen.has(target)) {
        continue;
      }
      seen.add(target);
      if (!isHidden(target) && !isDisabled(target)) {
        return target;
      }
    }
  }

  return null;
}

export function claimChannelPointsBonus(
  root: QueryRootLike,
  options?: { supportedPage?: boolean },
): ChannelPointsClaimResult {
  if (options?.supportedPage === false) {
    return { claimed: false, reason: 'not-supported-page' };
  }

  const target = findClaimableChannelPointsBonusButton(root);
  if (!target) {
    return { claimed: false, reason: 'not-available' };
  }

  target.click?.();
  return { claimed: true, reason: 'claimed' };
}
