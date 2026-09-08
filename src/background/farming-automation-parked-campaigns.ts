import type { CampaignAvailability } from '../types/index.ts';
import type { FarmingAutomationFactsV1 } from './farming-automation-contracts.ts';
import { PARKED_CAMPAIGN_RETRY_MS } from './farming-automation-gates.ts';

export function reconcileParkedCampaigns(
  facts: FarmingAutomationFactsV1,
  availability: Readonly<Record<string, CampaignAvailability>>,
  now: number,
) {
  const keys = new Set<string>();
  const until: Record<string, number> = {};
  for (const key of facts.suppressedCampaignKeys) {
    const retryAt = facts.suppressedUntilByCampaignKey[key] ?? 0;
    if (retryAt > now || (availability[key]?.eligibleStreamerCount ?? 0) <= 0) {
      keys.add(key);
      until[key] = retryAt > now ? retryAt : now + PARKED_CAMPAIGN_RETRY_MS;
    }
  }
  const next = [...keys];
  const changed =
    JSON.stringify(next) !== JSON.stringify(facts.suppressedCampaignKeys) ||
    JSON.stringify(until) !== JSON.stringify(facts.suppressedUntilByCampaignKey);
  return {
    parkedKeys: keys,
    facts: changed
      ? {
          ...facts,
          suppressedCampaignKeys: next,
          suppressedUntilByCampaignKey: until,
          nextEvaluationAt: Math.min(
            ...Object.values(until),
            facts.nextEvaluationAt ?? Number.POSITIVE_INFINITY,
          ),
        }
      : facts,
    changed,
  };
}
