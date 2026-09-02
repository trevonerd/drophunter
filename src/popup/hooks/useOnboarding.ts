// Extracted from src/popup/App.tsx (onboarding + first-sync confirmation flow).
import { useEffect, useState } from 'react';
import { browser } from '../../shared/browser-api.ts';
import { sendRuntimeMessage } from '../../shared/messages';
import type { AppState } from '../../types';
import { logPopupWarn } from '../logging';

interface FirstSyncConfirmationInput {
  readonly onboardingLoaded: boolean;
  readonly onboardingCompleted: AppState['twitchSessionDetected'];
  readonly hasUnseenRefreshSuccess: boolean;
  readonly refreshInProgress: boolean;
}

export function shouldShowFirstSyncConfirmation({
  onboardingLoaded,
  onboardingCompleted,
  hasUnseenRefreshSuccess,
  refreshInProgress,
}: FirstSyncConfirmationInput): boolean {
  return onboardingLoaded && !onboardingCompleted && hasUnseenRefreshSuccess && !refreshInProgress;
}

export function useOnboarding(state: AppState) {
  const [onboardingCompleted, setOnboardingCompleted] = useState(false);
  const [onboardingLoaded, setOnboardingLoaded] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState<'selector' | 'start' | null>(null);
  const [firstSyncConfirmation, setFirstSyncConfirmation] = useState(false);
  const [firstSyncCampaignCount, setFirstSyncCampaignCount] = useState<number | null>(null);
  const [acknowledgedRefreshCompletedAt, setAcknowledgedRefreshCompletedAt] = useState<number | null>(null);

  const refreshCompletedAt = state.lastDropsPageRefreshCompletedAt ?? 0;
  const refreshNoticeSeenAt = state.lastDropsPageRefreshNoticeSeenAt ?? 0;
  const refreshCampaignCount = state.lastDropsPageRefreshCampaignCount ?? state.availableGames.length;
  const hasUnseenRefreshSuccess =
    refreshCompletedAt > refreshNoticeSeenAt &&
    refreshCompletedAt !== acknowledgedRefreshCompletedAt &&
    refreshCampaignCount > 0;

  useEffect(() => {
    const loadOnboarding = async () => {
      const stored = await browser.storage.local.get('onboardingCompleted').catch((error: unknown) => {
        logPopupWarn('Unable to load onboardingCompleted:', error);
        return {} as Record<string, unknown>;
      });
      if (stored.onboardingCompleted === true) {
        setOnboardingCompleted(true);
      }
      setOnboardingLoaded(true);
    };

    loadOnboarding();
  }, []);

  useEffect(() => {
    if (!firstSyncConfirmation) {
      return;
    }
    const timer = window.setTimeout(() => {
      setFirstSyncConfirmation(false);
      setFirstSyncCampaignCount(null);
    }, 30000);
    return () => window.clearTimeout(timer);
  }, [firstSyncConfirmation]);

  useEffect(() => {
    if (!onboardingLoaded || !hasUnseenRefreshSuccess || state.dropsPageRefreshInProgress) {
      return;
    }
    const count = refreshCampaignCount;
    if (
      shouldShowFirstSyncConfirmation({
        onboardingLoaded,
        onboardingCompleted,
        hasUnseenRefreshSuccess,
        refreshInProgress: state.dropsPageRefreshInProgress,
      })
    ) {
      setFirstSyncCampaignCount(count);
      setFirstSyncConfirmation(true);
      setOnboardingStep((current) => current ?? 'selector');
    }
    setAcknowledgedRefreshCompletedAt(refreshCompletedAt);
    sendRuntimeMessage({
      type: 'MARK_DROPS_REFRESH_NOTICE_SEEN',
      payload: { seenAt: refreshCompletedAt },
    }).catch((error: unknown) => logPopupWarn('MARK_DROPS_REFRESH_NOTICE_SEEN failed:', error));
  }, [
    hasUnseenRefreshSuccess,
    onboardingLoaded,
    onboardingCompleted,
    refreshCampaignCount,
    refreshCompletedAt,
    state.dropsPageRefreshInProgress,
  ]);

  return {
    onboardingCompleted,
    setOnboardingCompleted,
    onboardingStep,
    setOnboardingStep,
    firstSyncConfirmation,
    firstSyncCampaignCount,
  };
}
