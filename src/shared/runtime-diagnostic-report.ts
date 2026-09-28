const PHASES = new Set([
  'idle',
  'running',
  'paused',
  'recovering',
  'stopped-terminal',
  'validating',
  'session-recovery',
]);
const OPERATIONS = new Set(['campaign', 'inventory', 'directory']);
const OUTCOMES = new Set(['failed']);
const FAILURE_KINDS = new Set([
  'twitch-auth',
  'twitch-integrity',
  'twitch-network',
  'twitch-rate-limit',
  'twitch-invalid-response',
  'twitch-data-unavailable',
  'directory-unavailable',
  'no-streamers',
  'stalled-progress',
  'open-failed',
  'drops-inactive',
  'wrong-game',
  'wrong-channel',
  'offline',
  'sign-in-required',
  'no-active-campaigns',
  'queue-complete',
  'farming-complete',
  'stall-skipped',
  'unverifiable-twitch',
  'user-stop',
  'unknown',
]);

function identifier(value: unknown): string | null {
  return typeof value === 'string' && /^[a-zA-Z0-9:._-]{1,256}$/.test(value) ? value : null;
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function buildRuntimeDiagnosticReport(stored: unknown): string {
  const events = Array.isArray(stored) ? stored.slice(-50) : [];
  const safe = events.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const value = entry as Record<string, unknown>;
    const build = identifier(value.build);
    const phase = PHASES.has(String(value.phase)) ? value.phase : null;
    const timestamp = number(value.timestamp);
    if (!build || !phase || timestamp === null) return [];
    const failureKind = FAILURE_KINDS.has(String(value.failureKind)) ? value.failureKind : null;
    const operation = OPERATIONS.has(String(value.operation)) ? value.operation : null;
    const outcome = OUTCOMES.has(String(value.outcome)) ? value.outcome : null;
    const httpStatus = number(value.httpStatus);
    return [
      {
        build,
        campaign: identifier(value.campaign),
        phase,
        failureKind,
        attempt: number(value.attempt),
        deadline: number(value.deadline),
        timestamp,
        ...(operation ? { operation } : {}),
        ...(outcome ? { outcome } : {}),
        ...(httpStatus !== null && Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599
          ? { httpStatus }
          : {}),
      },
    ];
  });
  return JSON.stringify({ kind: 'DropHunter runtime diagnostics', events: safe }, null, 2);
}
