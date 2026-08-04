import { describe, expect, test } from 'bun:test';
import {
  classifyManualWatch,
  MANUAL_WATCH_TTL_MS,
  type PassiveViewingTelemetry,
} from '../src/background/manual-watch-policy.ts';

describe('classifyManualWatch', () => {
  test('classifies missing telemetry as inactive', () => {
    expect(classifyManualWatch(null, 10_000)).toEqual({
      kind: 'inactive',
      reason: 'no-recent-visible-twitch',
    });
  });

  test('classifies a fresh visible eligible Twitch view as eligible manual watch', () => {
    expect(
      classifyManualWatch(
        {
          observedAt: 10_000,
          isVisible: true,
          isTwitch: true,
          isPlaybackReady: true,
          channelEligible: true,
          categoryEligible: true,
          campaignEligible: true,
          automationActive: false,
        },
        10_001,
      ),
    ).toEqual({
      kind: 'eligible-manual',
      reason: 'eligible-channel',
    });
  });

  test('pauses automation for a fresh visible ineligible Twitch view', () => {
    expect(
      classifyManualWatch(
        {
          observedAt: 10_000,
          isVisible: true,
          isTwitch: true,
          isPlaybackReady: true,
          channelEligible: false,
          categoryEligible: true,
          campaignEligible: true,
          automationActive: true,
        },
        10_001,
      ),
    ).toEqual({
      kind: 'automation-paused',
      reason: 'ineligible-manual-view',
    });
  });

  test('stays inactive when a visible Twitch video is paused', () => {
    expect(
      classifyManualWatch(
        {
          observedAt: 10_000,
          isVisible: true,
          isTwitch: true,
          isPlaybackReady: false,
          channelEligible: false,
          categoryEligible: true,
          campaignEligible: true,
          automationActive: true,
        },
        10_001,
      ),
    ).toEqual({
      kind: 'inactive',
      reason: 'no-recent-visible-twitch',
    });
  });

  test('expires telemetry at the 20-second TTL boundary', () => {
    expect(
      classifyManualWatch(
        {
          observedAt: 10_000,
          isVisible: true,
          isTwitch: true,
          isPlaybackReady: true,
          channelEligible: true,
          categoryEligible: true,
          campaignEligible: true,
          automationActive: false,
        },
        10_000 + MANUAL_WATCH_TTL_MS,
      ),
    ).toEqual({
      kind: 'inactive',
      reason: 'no-recent-visible-twitch',
    });
  });

  test('keeps telemetry fresh one millisecond before the TTL boundary', () => {
    expect(
      classifyManualWatch(
        {
          observedAt: 10_000,
          isVisible: true,
          isTwitch: true,
          isPlaybackReady: true,
          channelEligible: true,
          categoryEligible: true,
          campaignEligible: true,
          automationActive: false,
        },
        10_000 + MANUAL_WATCH_TTL_MS - 1,
      ),
    ).toEqual({
      kind: 'eligible-manual',
      reason: 'eligible-channel',
    });
  });

  test('does not pause automation after telemetry expires', () => {
    expect(
      classifyManualWatch(
        {
          observedAt: 10_000,
          isVisible: true,
          isTwitch: true,
          isPlaybackReady: true,
          channelEligible: false,
          categoryEligible: true,
          campaignEligible: true,
          automationActive: true,
        },
        10_000 + MANUAL_WATCH_TTL_MS,
      ),
    ).toEqual({
      kind: 'inactive',
      reason: 'no-recent-visible-twitch',
    });
  });

  test('stays inactive when the fresh view is hidden, non-Twitch, or automation is idle', () => {
    const cases = [
      {
        observedAt: 10_000,
        isVisible: false,
        isTwitch: true,
        isPlaybackReady: true,
        channelEligible: false,
        categoryEligible: true,
        campaignEligible: true,
        automationActive: true,
      },
      {
        observedAt: 10_000,
        isVisible: true,
        isTwitch: false,
        isPlaybackReady: true,
        channelEligible: false,
        categoryEligible: true,
        campaignEligible: true,
        automationActive: true,
      },
      {
        observedAt: 10_000,
        isVisible: true,
        isTwitch: true,
        isPlaybackReady: false,
        channelEligible: false,
        categoryEligible: true,
        campaignEligible: true,
        automationActive: false,
      },
    ] satisfies PassiveViewingTelemetry[];

    for (const telemetry of cases) {
      expect(classifyManualWatch(telemetry, 10_001)).toEqual({
        kind: 'inactive',
        reason: 'no-recent-visible-twitch',
      });
    }
  });
});
