import { describe, expect, test } from 'bun:test';
import * as subject from './drop-processing-support.ts';

export function registerDropProcessing06(): void {
  describe('subject.dropStateKey', () => {
    test('returns id::campaignId when campaignId is present', () => {
      const drop = { id: 'drop-123', campaignId: 'camp-456' } as subject.TwitchDrop;
      expect(subject.dropStateKey(drop)).toBe('drop-123::camp-456');
    });

    test('returns id::empty string when campaignId is missing', () => {
      const drop = { id: 'drop-789', campaignId: undefined } as subject.TwitchDrop;
      expect(subject.dropStateKey(drop)).toBe('drop-789::');
    });
  });
}
