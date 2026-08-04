export const MANUAL_WATCH_TTL_MS = 20_000 as const;

export type PassiveViewingTelemetry = {
  readonly observedAt: number;
  readonly isVisible: boolean;
  readonly isTwitch: boolean;
  readonly isPlaybackReady: boolean;
  readonly channelEligible: boolean;
  readonly categoryEligible: boolean;
  readonly campaignEligible: boolean;
  readonly automationActive: boolean;
};

export type ManualWatchClassification =
  | { readonly kind: 'inactive'; readonly reason: 'no-recent-visible-twitch' }
  | { readonly kind: 'eligible-manual'; readonly reason: 'eligible-channel' }
  | { readonly kind: 'automation-paused'; readonly reason: 'ineligible-manual-view' };

export function classifyManualWatch(
  telemetry: PassiveViewingTelemetry | null,
  now: number,
): ManualWatchClassification {
  if (telemetry === null) {
    return { kind: 'inactive', reason: 'no-recent-visible-twitch' };
  }

  const ageMs = now - telemetry.observedAt;
  const isFresh = ageMs >= 0 && ageMs < MANUAL_WATCH_TTL_MS;
  const isVisibleTwitch = telemetry.isVisible && telemetry.isTwitch && telemetry.isPlaybackReady;
  const isEligible =
    isVisibleTwitch && telemetry.channelEligible && telemetry.categoryEligible && telemetry.campaignEligible;

  if (isFresh && isEligible) {
    return { kind: 'eligible-manual', reason: 'eligible-channel' };
  }

  if (isFresh && isVisibleTwitch && telemetry.automationActive) {
    return { kind: 'automation-paused', reason: 'ineligible-manual-view' };
  }

  return { kind: 'inactive', reason: 'no-recent-visible-twitch' };
}
