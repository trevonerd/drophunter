export type ChannelPointsClaimReason = 'claimed' | 'not-available' | 'not-supported-page';

export interface ChannelPointsClaimResult {
  claimed: boolean;
  reason: ChannelPointsClaimReason;
}

interface ButtonLike {
  textContent?: string | null;
  disabled?: boolean;
  hidden?: boolean;
  click?: () => void;
  closest?: (selector: string) => ButtonLike | null;
  querySelector?: (selector: string) => ButtonLike | null;
  getAttribute: (name: string) => string | null;
}

interface QueryRootLike {
  querySelectorAll: (selector: string) => ArrayLike<ButtonLike> | Iterable<ButtonLike>;
}

interface CandidateButton {
  button: ButtonLike;
  explicitBonusMatch: boolean;
}

const EXPLICIT_BONUS_SELECTORS = [
  '[data-test-selector*="claimable-bonus"]',
  '[data-test-selector*="bonus-icon"]',
  '[data-a-target*="bonus"]',
];

const BUTTON_FALLBACK_SELECTORS = [
  'button[aria-label]',
  '[role="button"][aria-label]',
  'button[title]',
  '[role="button"][title]',
];

function normalizeText(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function toArray<T>(value: ArrayLike<T> | Iterable<T>): T[] {
  return Array.from(value);
}

function getAttribute(element: ButtonLike, name: string): string {
  return normalizeText(element.getAttribute(name));
}

function hasAttribute(element: ButtonLike, name: string): boolean {
  return element.getAttribute(name) !== null;
}

function getButtonDescriptor(element: ButtonLike): string {
  return [
    normalizeText(element.textContent),
    getAttribute(element, 'aria-label'),
    getAttribute(element, 'title'),
    getAttribute(element, 'data-test-selector'),
    getAttribute(element, 'data-a-target'),
  ]
    .filter(Boolean)
    .join(' ');
}

function resolveClickableButton(candidate: ButtonLike): ButtonLike | null {
  return candidate.closest?.('button, [role="button"]') ?? candidate;
}

function isHidden(element: ButtonLike): boolean {
  return (
    Boolean(element.hidden) ||
    hasAttribute(element, 'hidden') ||
    getAttribute(element, 'aria-hidden') === 'true'
  );
}

function isDisabled(element: ButtonLike): boolean {
  return (
    Boolean(element.disabled) ||
    hasAttribute(element, 'disabled') ||
    getAttribute(element, 'aria-disabled') === 'true'
  );
}

function isRewardRedemptionButton(button: ButtonLike): boolean {
  const descriptor = getButtonDescriptor(button);
  return (
    descriptor.includes('redeem') ||
    descriptor.includes('reward') ||
    descriptor.includes('unlock') ||
    descriptor.includes('use points')
  );
}

function isClaimBonusFallbackButton(button: ButtonLike): boolean {
  const descriptor = getButtonDescriptor(button);
  return descriptor.includes('claim bonus') || descriptor.includes('bonus claim');
}

function hasExplicitBonusDescendant(button: ButtonLike): boolean {
  return Boolean(
    button.querySelector?.(
      '[data-test-selector*="claimable-bonus"], [data-test-selector*="bonus-icon"], [data-a-target*="bonus"]',
    ),
  );
}

function collectCandidateButtons(root: QueryRootLike): CandidateButton[] {
  const unique = new Set<ButtonLike>();
  const candidates: CandidateButton[] = [];

  const addCandidate = (raw: ButtonLike, explicitBonusMatch: boolean) => {
    const button = resolveClickableButton(raw);
    if (!button || unique.has(button)) {
      return;
    }
    unique.add(button);
    candidates.push({ button, explicitBonusMatch });
  };

  for (const selector of EXPLICIT_BONUS_SELECTORS) {
    for (const candidate of toArray(root.querySelectorAll(selector))) {
      addCandidate(candidate, true);
    }
  }

  for (const selector of BUTTON_FALLBACK_SELECTORS) {
    for (const candidate of toArray(root.querySelectorAll(selector))) {
      addCandidate(candidate, false);
    }
  }

  return candidates;
}

export function findClaimableChannelPointsBonusButton(root: QueryRootLike): ButtonLike | null {
  const candidates = collectCandidateButtons(root);
  for (const { button, explicitBonusMatch } of candidates) {
    if (isHidden(button) || isDisabled(button) || isRewardRedemptionButton(button)) {
      continue;
    }
    if (explicitBonusMatch || hasExplicitBonusDescendant(button) || isClaimBonusFallbackButton(button)) {
      return button;
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

  const button = findClaimableChannelPointsBonusButton(root);
  if (!button) {
    return { claimed: false, reason: 'not-available' };
  }

  button.click?.();
  return { claimed: true, reason: 'claimed' };
}
