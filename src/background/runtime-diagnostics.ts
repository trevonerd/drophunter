import { browser } from '../shared/browser-api.ts';
import { gameKey } from '../shared/game-selection.ts';
import { deriveRuntimeMode } from '../shared/runtime-status.ts';
import type { AppState } from '../types/index.ts';
import { logWarn } from './logging.ts';

export const RUNTIME_DIAGNOSTICS_STORAGE_KEY = 'runtimeDiagnostics';
export const MAX_RUNTIME_DIAGNOSTIC_EVENTS = 200;

const PHASES = [
  'idle',
  'running',
  'paused',
  'recovering',
  'stopped-terminal',
  'validating',
  'session-recovery',
] as const;
const FAILURE_KINDS = [
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
] as const;

export interface RuntimeDiagnosticEvent {
  readonly build: string;
  readonly campaign: string | null;
  readonly phase: (typeof PHASES)[number];
  readonly failureKind: (typeof FAILURE_KINDS)[number] | null;
  readonly attempt: number | null;
  readonly deadline: number | null;
  readonly timestamp: number;
}

function safeIdentifier(value: unknown): string | null {
  return typeof value === 'string' && /^[a-zA-Z0-9:._-]{1,256}$/.test(value) ? value : null;
}

function finiteNonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function failureKind(value: unknown): RuntimeDiagnosticEvent['failureKind'] {
  if (value === null || value === undefined) return null;
  return FAILURE_KINDS.find((kind) => kind === value) ?? 'unknown';
}

function normalizeEvent(value: unknown): RuntimeDiagnosticEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const build = 'build' in value ? safeIdentifier(value.build) : null;
  const phase = 'phase' in value ? PHASES.find((candidate) => candidate === value.phase) : undefined;
  const timestamp = 'timestamp' in value ? finiteNonNegative(value.timestamp) : null;
  if (build === null || phase === undefined || timestamp === null) return null;
  return {
    build,
    phase,
    timestamp,
    campaign: 'campaign' in value ? safeIdentifier(value.campaign) : null,
    failureKind: 'failureKind' in value ? failureKind(value.failureKind) : null,
    attempt: 'attempt' in value ? finiteNonNegative(value.attempt) : null,
    deadline: 'deadline' in value ? finiteNonNegative(value.deadline) : null,
  };
}

function transitionSignature(event: RuntimeDiagnosticEvent): string {
  return JSON.stringify([
    event.build,
    event.campaign,
    event.phase,
    event.failureKind,
    event.attempt,
    event.deadline,
  ]);
}

export function appendRuntimeDiagnosticEvent(
  stored: unknown,
  event: RuntimeDiagnosticEvent,
): readonly RuntimeDiagnosticEvent[] {
  const events = Array.isArray(stored)
    ? stored.slice(-MAX_RUNTIME_DIAGNOSTIC_EVENTS).flatMap((value: unknown) => {
        const normalized = normalizeEvent(value);
        return normalized === null ? [] : [normalized];
      })
    : [];
  const previous = events[events.length - 1];
  const normalizedEvent = normalizeEvent(event);
  if (normalizedEvent === null) return events;
  if (previous && transitionSignature(previous) === transitionSignature(normalizedEvent)) return events;
  return [...events, normalizedEvent].slice(-MAX_RUNTIME_DIAGNOSTIC_EVENTS);
}

function snapshotDiagnostic(state: AppState): Omit<RuntimeDiagnosticEvent, 'build'> {
  const campaign =
    state.selectedGame && (state.selectedGame.campaignId || state.selectedGame.id)
      ? safeIdentifier(gameKey(state.selectedGame))
      : null;
  const mode = deriveRuntimeMode(state);
  const phase =
    mode === 'paused'
      ? mode
      : state.campaignSyncState.status === 'syncing'
        ? 'validating'
        : state.twitchSessionSyncState.status === 'retrying'
          ? 'session-recovery'
          : mode;
  const sync = state.campaignSyncState;
  const session = state.twitchSessionSyncState;
  return {
    campaign,
    phase,
    failureKind: failureKind(state.recoveryReason ?? state.lastStopReason),
    attempt: finiteNonNegative(
      state.recoveryAttempts ?? (session.status === 'retrying' ? session.attempts : sync.retryAttemptCount),
    ),
    deadline: finiteNonNegative(
      state.recoveryBackoffUntil ?? session.nextRetryAt ?? sync.nextRetryAt ?? sync.attemptDeadlineAt,
    ),
    timestamp: Date.now(),
  };
}

let pendingWrite: Promise<void> = Promise.resolve();

export function recordRuntimeDiagnostic(state: AppState): void {
  const snapshot = snapshotDiagnostic(state);
  pendingWrite = pendingWrite
    .then(async () => {
      const manifest = browser.runtime.getManifest();
      const event: RuntimeDiagnosticEvent = {
        ...snapshot,
        build: safeIdentifier(manifest.version_name ?? manifest.version) ?? 'unknown',
      };
      const stored = await browser.storage.local.get(RUNTIME_DIAGNOSTICS_STORAGE_KEY);
      const previous: unknown = stored[RUNTIME_DIAGNOSTICS_STORAGE_KEY];
      const events = appendRuntimeDiagnosticEvent(previous, event);
      if (JSON.stringify(previous) !== JSON.stringify(events)) {
        await browser.storage.local.set({ [RUNTIME_DIAGNOSTICS_STORAGE_KEY]: events });
      }
    })
    .catch(() => {
      // Diagnostics are best effort at this storage boundary; never retain or print raw failures.
      logWarn('Runtime diagnostic storage unavailable');
    });
}

export function flushRuntimeDiagnosticsForTests(): Promise<void> {
  return pendingWrite;
}
