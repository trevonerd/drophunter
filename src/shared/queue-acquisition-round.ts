import type { QueueAcquisitionRound } from '../types/index.ts';

export function normalizeQueueAcquisitionRound(value: unknown): QueueAcquisitionRound | null {
  if (typeof value !== 'object' || value === null || !('attemptedCampaignKeys' in value)) return null;
  const keys = value.attemptedCampaignKeys;
  if (!Array.isArray(keys)) return null;
  const nextRoundAt = 'nextRoundAt' in value ? value.nextRoundAt : null;
  return {
    attemptedCampaignKeys: [
      ...new Set(keys.filter((key): key is string => typeof key === 'string' && key.length > 0)),
    ],
    nextRoundAt:
      typeof nextRoundAt === 'number' && Number.isFinite(nextRoundAt) && nextRoundAt > 0 ? nextRoundAt : null,
  };
}
