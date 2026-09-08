import type { FarmingAutomationOutcome, FarmingAutomationTrigger } from './farming-automation-contracts.ts';

export function shouldRefreshAvailabilityOnly(
  gate: FarmingAutomationOutcome | null,
  triggers: ReadonlySet<FarmingAutomationTrigger>,
  campaignPriorityMode: string,
): boolean {
  return (
    gate?.kind === 'unchanged' &&
    gate.reason === 'disabled' &&
    triggers.has('campaign-refresh') &&
    campaignPriorityMode === 'lowest-availability'
  );
}
