import type { WatchHealth } from './watch-transport.ts';

export interface DisposableWatchCandidate {
  readonly health: WatchHealth;
  readonly dispose: () => Promise<void>;
}

export type WatchCandidatePreparation<Candidate extends DisposableWatchCandidate> =
  | { readonly kind: 'prepared'; readonly candidate: Candidate }
  | { readonly kind: 'failed'; readonly health: WatchHealth | null };

interface WatchCandidatePreparationOptions<Candidate extends DisposableWatchCandidate> {
  readonly prepare: () => Promise<Candidate | null>;
  readonly isCurrent: () => boolean;
  readonly accept?: (health: WatchHealth) => boolean;
}

export async function prepareWatchCandidate<Candidate extends DisposableWatchCandidate>(
  options: WatchCandidatePreparationOptions<Candidate>,
): Promise<WatchCandidatePreparation<Candidate>> {
  if (!options.isCurrent()) return { kind: 'failed', health: null };
  let candidate: Candidate | null;
  try {
    candidate = await options.prepare();
  } catch (error) {
    if (error instanceof Error) return { kind: 'failed', health: null };
    throw error;
  }
  if (!candidate) return { kind: 'failed', health: null };
  const accepts = options.accept ?? ((health: WatchHealth) => health.isHealthy);
  if (options.isCurrent() && accepts(candidate.health)) {
    return { kind: 'prepared', candidate };
  }
  await candidate.dispose();
  return { kind: 'failed', health: candidate.health };
}
