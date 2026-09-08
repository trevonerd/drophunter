import { describe, expect, test } from 'bun:test';
import * as subject from './drop-processing-support.ts';

export function registerDropProcessing08(): void {
  describe('subject.isDropCampaignExpired', () => {
    test('returns false when endsAt is missing', () => {
      const drop = { id: '1' } as subject.TwitchDrop;
      expect(subject.isDropCampaignExpired(drop)).toBe(false);
    });

    test('returns false when endsAt is in the future', () => {
      const future = new Date(Date.now() + 10_000).toISOString();
      const drop = { id: '1', endsAt: future } as subject.TwitchDrop;
      expect(subject.isDropCampaignExpired(drop)).toBe(false);
    });

    test('returns true when endsAt is in the past', () => {
      const past = new Date(Date.now() - 10_000).toISOString();
      const drop = { id: '1', endsAt: past } as subject.TwitchDrop;
      expect(subject.isDropCampaignExpired(drop)).toBe(true);
    });
  });
}
