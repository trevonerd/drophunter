import { describe, expect, test } from 'bun:test';
import { classifyStartupPresentation } from '../src/shared/startup-presentation.ts';
import type { CampaignSyncState } from '../src/types/index.ts';

describe('startup presentation', () => {
  const initial: CampaignSyncState = {
    status: 'idle',
    lastAttemptAt: null,
    lastSuccessAt: null,
    campaignCount: null,
    retryAttemptCount: 0,
    lastErrorKind: null,
    nextRetryAt: null,
    attemptDeadlineAt: null,
  };

  test('is normal when startup is not blocked', () => {
    expect(
      classifyStartupPresentation({
        blocksStartup: false,
        automaticStartPending: true,
        campaignSyncState: initial,
      }),
    ).toBe('normal');
  });

  test.each([
    initial,
    { ...initial, status: 'syncing', attemptDeadlineAt: 1_000 },
    {
      ...initial,
      status: 'retry-scheduled',
      retryAttemptCount: 2,
      nextRetryAt: 2_000,
      error: 'temporary network error',
    },
  ] satisfies CampaignSyncState[])('keeps routine automatic startup silent', (campaignSyncState) => {
    expect(
      classifyStartupPresentation({
        blocksStartup: true,
        automaticStartPending: true,
        campaignSyncState,
      }),
    ).toBe('starting-silently');
  });

  test('shows a blocker after routine retries are exhausted', () => {
    expect(
      classifyStartupPresentation({
        blocksStartup: true,
        automaticStartPending: true,
        campaignSyncState: {
          ...initial,
          status: 'retry-scheduled',
          retryAttemptCount: 3,
          nextRetryAt: 2_000,
          error: 'temporary network error',
        },
      }),
    ).toBe('blocked');
  });
});
