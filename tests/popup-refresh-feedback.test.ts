import { expect, test } from 'bun:test';
import { shouldShowFirstSyncConfirmation } from '../src/popup/hooks/useOnboarding.ts';

test('automatic refresh success stays silent after onboarding is complete', () => {
  expect(
    shouldShowFirstSyncConfirmation({
      onboardingLoaded: true,
      onboardingCompleted: true,
      hasUnseenRefreshSuccess: true,
      refreshInProgress: false,
    }),
  ).toBe(false);
});

test('the first successful Twitch connection still gets one confirmation', () => {
  expect(
    shouldShowFirstSyncConfirmation({
      onboardingLoaded: true,
      onboardingCompleted: false,
      hasUnseenRefreshSuccess: true,
      refreshInProgress: false,
    }),
  ).toBe(true);
});
