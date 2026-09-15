import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { formatCampaignEnd } from '../src/popup/components/campaign-list-model.ts';
import { QueueChips } from '../src/popup/components/QueueChips.tsx';
import { campaignRejectionReason } from '../src/shared/campaign-eligibility.ts';
import { isExpiredGame } from '../src/shared/utils.ts';
import type { TwitchGame } from '../src/types/index.ts';

const campaign: TwitchGame = {
  id: 'rainbow-six-siege',
  name: 'Rainbow Six Siege',
  campaignId: 'r6-s2-2026-2',
  imageUrl: '',
  endsAt: '2026-09-09T06:58:00+02:00',
  expiresInMs: 64 * 60_000,
};

describe('campaign expiry across browser sleep', () => {
  test('shows expired in catalog and queue instead of the cached remaining hour', () => {
    const now = Date.parse('2026-09-09T07:30:00+02:00');
    expect(formatCampaignEnd(campaign, now)).toBe('Expired');
    const markup = renderToStaticMarkup(
      createElement(QueueChips, {
        selectedGame: null,
        queueGames: [campaign],
        isRunning: false,
        now,
        onRemove: () => undefined,
        onClear: () => undefined,
        onReorder: () => undefined,
      }),
    );
    expect(markup).toContain('Expired');
    expect(markup).not.toContain('Ends in 1h');
  });

  test('rejects an expired campaign despite its positive cached countdown', () => {
    const now = Date.parse('2026-09-09T07:30:00+02:00');
    expect(isExpiredGame(campaign, now)).toBe(true);
    expect(campaignRejectionReason(campaign, now)).toBe('expired');
  });

  test('uses the absolute deadline at the boundary with an explicit timezone', () => {
    expect(isExpiredGame(campaign, Date.parse('2026-09-09T04:57:59Z'))).toBe(false);
    expect(isExpiredGame(campaign, Date.parse('2026-09-09T04:58:00Z'))).toBe(true);
  });

  test('prefers a corrected future deadline over an old negative countdown', () => {
    expect(isExpiredGame({ ...campaign, expiresInMs: -1 }, Date.parse('2026-09-09T04:00:00Z'))).toBe(false);
  });

  test.each([null, 'not-a-date'])('falls back to relative expiry when endsAt is %s', (endsAt) => {
    expect(isExpiredGame({ ...campaign, endsAt, expiresInMs: 0 })).toBe(true);
    expect(isExpiredGame({ ...campaign, endsAt, expiresInMs: 1 })).toBe(false);
  });
});
