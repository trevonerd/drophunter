import type {
  FarmingAutomationFactsV1,
  FarmingAutomationLastPreemptionV1,
  FarmingAutomationManualWatchV1,
  StoredRecordNormalization,
} from './farming-automation-contracts.ts';

export { normalizeFarmingSessionTransitionReceipt } from './farming-automation-receipt-facts.ts';

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function isNonEmptyString(input: unknown): input is string {
  return typeof input === 'string' && input.length > 0;
}

function isFiniteNumber(input: unknown): input is number {
  return typeof input === 'number' && Number.isFinite(input);
}

function normalizeSuppressedCampaignKeys(input: unknown): readonly string[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.filter(isNonEmptyString))];
}

function hasOnlyKeys(input: object, keys: readonly string[]): boolean {
  return Object.keys(input).length === keys.length && keys.every((key) => key in input);
}

function isLastPreemption(input: unknown): input is FarmingAutomationLastPreemptionV1 {
  return (
    isRecord(input) &&
    isNonEmptyString(input.attemptId) &&
    isNonEmptyString(input.fromCampaignKey) &&
    isNonEmptyString(input.toCampaignKey) &&
    isFiniteNumber(input.committedAt) &&
    isNonEmptyString(input.sessionRevision)
  );
}

function isManualWatch(input: unknown): input is FarmingAutomationManualWatchV1 {
  return (
    isRecord(input) &&
    (input.kind === 'eligible-manual' || input.kind === 'automation-paused') &&
    isFiniteNumber(input.observedAt) &&
    isFiniteNumber(input.expiresAt) &&
    isFiniteNumber(input.recheckAt)
  );
}

export function createInitialFarmingAutomationFacts(): FarmingAutomationFactsV1 {
  return {
    version: 1,
    lastPreemption: null,
    manualWatch: null,
    nextEvaluationAt: null,
    suppressedCampaignKeys: [],
  };
}

export function normalizeFarmingAutomationFacts(
  input: unknown,
): StoredRecordNormalization<FarmingAutomationFactsV1> {
  if (input === undefined) {
    return { kind: 'missing', value: createInitialFarmingAutomationFacts() };
  }
  if (!isRecord(input) || input.version !== 1) {
    return { kind: 'unsupported', raw: input };
  }
  const lastPreemption = isLastPreemption(input.lastPreemption)
    ? {
        attemptId: input.lastPreemption.attemptId,
        fromCampaignKey: input.lastPreemption.fromCampaignKey,
        toCampaignKey: input.lastPreemption.toCampaignKey,
        committedAt: input.lastPreemption.committedAt,
        sessionRevision: input.lastPreemption.sessionRevision,
      }
    : null;
  const manualWatch = isManualWatch(input.manualWatch)
    ? {
        kind: input.manualWatch.kind,
        observedAt: input.manualWatch.observedAt,
        expiresAt: input.manualWatch.expiresAt,
        recheckAt: input.manualWatch.recheckAt,
      }
    : null;
  const nextEvaluationAt = isFiniteNumber(input.nextEvaluationAt) ? input.nextEvaluationAt : null;
  const suppressedCampaignKeys = normalizeSuppressedCampaignKeys(input.suppressedCampaignKeys);
  const value: FarmingAutomationFactsV1 = {
    version: 1,
    lastPreemption,
    manualWatch,
    nextEvaluationAt,
    suppressedCampaignKeys,
  };
  const isCanonical =
    hasOnlyKeys(input, [
      'version',
      'lastPreemption',
      'manualWatch',
      'nextEvaluationAt',
      'suppressedCampaignKeys',
    ]) &&
    (input.lastPreemption === null ||
      (isLastPreemption(input.lastPreemption) &&
        hasOnlyKeys(input.lastPreemption, [
          'attemptId',
          'fromCampaignKey',
          'toCampaignKey',
          'committedAt',
          'sessionRevision',
        ]))) &&
    (input.manualWatch === null ||
      (isManualWatch(input.manualWatch) &&
        hasOnlyKeys(input.manualWatch, ['kind', 'observedAt', 'expiresAt', 'recheckAt']))) &&
    (input.nextEvaluationAt === null || isFiniteNumber(input.nextEvaluationAt)) &&
    Array.isArray(input.suppressedCampaignKeys) &&
    input.suppressedCampaignKeys.length === suppressedCampaignKeys.length &&
    input.suppressedCampaignKeys.every((campaignKey, index) => campaignKey === suppressedCampaignKeys[index]);
  return isCanonical ? { kind: 'valid', value } : { kind: 'repairable', value };
}
