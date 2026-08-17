import type {
  FarmingAutomationFactsV1,
  FarmingAutomationLastPreemptionV1,
  FarmingAutomationManualWatchV1,
  FarmingSessionTransitionReceiptV1,
  StoredRecordNormalization,
  WatchCleanupV1,
  WatchOwnershipV1,
} from './farming-automation-contracts.ts';

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function isNonEmptyString(input: unknown): input is string {
  return typeof input === 'string' && input.length > 0;
}

function isFiniteNumber(input: unknown): input is number {
  return typeof input === 'number' && Number.isFinite(input);
}

function hasOnlyKeys(input: object, keys: readonly string[]): boolean {
  return Object.keys(input).length === keys.length && keys.every((key) => key in input);
}

function assertNever(input: never): never {
  throw new DOMException(`Unexpected variant: ${String(input)}`, 'InvariantError');
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

function isWatchOwnership(input: unknown): input is WatchOwnershipV1 {
  if (!isRecord(input)) {
    return false;
  }
  if (input.kind === 'tabless') {
    return isNonEmptyString(input.targetKey);
  }
  if (input.kind === 'managed-tab') {
    return (
      Number.isInteger(input.tabId) &&
      typeof input.tabId === 'number' &&
      input.tabId >= 0 &&
      isNonEmptyString(input.ownershipToken) &&
      isNonEmptyString(input.expectedChannel)
    );
  }
  return false;
}

function isWatchCleanup(input: unknown): input is WatchCleanupV1 {
  if (!isRecord(input)) {
    return false;
  }
  switch (input.kind) {
    case 'not-required':
      return true;
    case 'pending':
      return isWatchOwnership(input.obsolete);
    case 'released':
      return (
        isFiniteNumber(input.releasedAt) && (input.method === 'closed' || input.method === 'neutralized')
      );
    case 'abandoned-unproven':
      return isFiniteNumber(input.acknowledgedAt);
    default:
      return false;
  }
}

function isTransitionReceipt(input: unknown): input is FarmingSessionTransitionReceiptV1 {
  return (
    isRecord(input) &&
    input.version === 1 &&
    isNonEmptyString(input.attemptId) &&
    (input.transition === 'start' || input.transition === 'preemption') &&
    (input.fromCampaignKey === null || isNonEmptyString(input.fromCampaignKey)) &&
    isNonEmptyString(input.toCampaignKey) &&
    isNonEmptyString(input.toStreamerName) &&
    isFiniteNumber(input.committedAt) &&
    isNonEmptyString(input.sessionRevision) &&
    (input.fromWatch === null || isWatchOwnership(input.fromWatch)) &&
    (input.toWatch === null || isWatchOwnership(input.toWatch)) &&
    isWatchCleanup(input.cleanup)
  );
}

function copyWatchOwnership(watch: WatchOwnershipV1): WatchOwnershipV1 {
  switch (watch.kind) {
    case 'tabless':
      return { kind: 'tabless', targetKey: watch.targetKey };
    case 'managed-tab':
      return {
        kind: 'managed-tab',
        tabId: watch.tabId,
        ownershipToken: watch.ownershipToken,
        expectedChannel: watch.expectedChannel,
      };
    default:
      return assertNever(watch);
  }
}

function copyWatchCleanup(cleanup: WatchCleanupV1): WatchCleanupV1 {
  switch (cleanup.kind) {
    case 'not-required':
      return { kind: 'not-required' };
    case 'pending':
      return { kind: 'pending', obsolete: copyWatchOwnership(cleanup.obsolete) };
    case 'released':
      return { kind: 'released', releasedAt: cleanup.releasedAt, method: cleanup.method };
    case 'abandoned-unproven':
      return { kind: 'abandoned-unproven', acknowledgedAt: cleanup.acknowledgedAt };
    default:
      return assertNever(cleanup);
  }
}

const WATCH_FIELD_COUNT = { tabless: 2, 'managed-tab': 4 } as const;
const CLEANUP_FIELD_COUNT = {
  'not-required': 1,
  pending: 2,
  released: 3,
  'abandoned-unproven': 2,
} as const;

function isCanonicalWatch(watch: WatchOwnershipV1): boolean {
  return Object.keys(watch).length === WATCH_FIELD_COUNT[watch.kind];
}

function isCanonicalCleanup(cleanup: WatchCleanupV1): boolean {
  const ownershipIsCanonical = 'obsolete' in cleanup ? isCanonicalWatch(cleanup.obsolete) : true;
  return Object.keys(cleanup).length === CLEANUP_FIELD_COUNT[cleanup.kind] && ownershipIsCanonical;
}

export function createInitialFarmingAutomationFacts(): FarmingAutomationFactsV1 {
  return {
    version: 1,
    lastPreemption: null,
    manualWatch: null,
    nextEvaluationAt: null,
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
  const value: FarmingAutomationFactsV1 = {
    version: 1,
    lastPreemption,
    manualWatch,
    nextEvaluationAt,
  };
  const isCanonical =
    hasOnlyKeys(input, ['version', 'lastPreemption', 'manualWatch', 'nextEvaluationAt']) &&
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
    (input.nextEvaluationAt === null || isFiniteNumber(input.nextEvaluationAt));
  return isCanonical ? { kind: 'valid', value } : { kind: 'repairable', value };
}

export function normalizeFarmingSessionTransitionReceipt(
  input: unknown,
): StoredRecordNormalization<FarmingSessionTransitionReceiptV1 | null> {
  if (input === undefined) {
    return { kind: 'missing', value: null };
  }
  if (isTransitionReceipt(input)) {
    const value: FarmingSessionTransitionReceiptV1 = {
      version: 1,
      attemptId: input.attemptId,
      transition: input.transition,
      fromCampaignKey: input.fromCampaignKey,
      toCampaignKey: input.toCampaignKey,
      toStreamerName: input.toStreamerName,
      committedAt: input.committedAt,
      sessionRevision: input.sessionRevision,
      fromWatch: input.fromWatch === null ? null : copyWatchOwnership(input.fromWatch),
      toWatch: input.toWatch === null ? null : copyWatchOwnership(input.toWatch),
      cleanup: copyWatchCleanup(input.cleanup),
    };
    const isCanonical =
      hasOnlyKeys(input, [
        'version',
        'attemptId',
        'transition',
        'fromCampaignKey',
        'toCampaignKey',
        'toStreamerName',
        'committedAt',
        'sessionRevision',
        'fromWatch',
        'toWatch',
        'cleanup',
      ]) &&
      (input.fromWatch === null || isCanonicalWatch(input.fromWatch)) &&
      (input.toWatch === null || isCanonicalWatch(input.toWatch)) &&
      isCanonicalCleanup(input.cleanup);
    return isCanonical ? { kind: 'valid', value } : { kind: 'repairable', value };
  }
  if (isRecord(input) && input.version === 1) {
    return { kind: 'repairable', value: null };
  }
  return { kind: 'unsupported', raw: input };
}
