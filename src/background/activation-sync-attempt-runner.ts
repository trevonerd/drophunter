import type { ActivationSyncAttempt } from './activation-sync-coordinator.ts';

function caughtAttempt(error: unknown): ActivationSyncAttempt {
  return {
    kind: 'transient-error',
    error: error instanceof Error ? error.message : String(error),
    errorKind: 'network',
  };
}

export function runActivationSyncAttempt(
  operation: Promise<ActivationSyncAttempt>,
  controller: AbortController,
  timeoutMs: number,
): Promise<ActivationSyncAttempt | null> {
  return new Promise((resolve) => {
    let timedOut = false;
    const settle = (result: ActivationSyncAttempt | null) => {
      globalThis.clearTimeout(timer);
      controller.signal.removeEventListener('abort', onAbort);
      resolve(result);
    };
    const onAbort = () =>
      settle(
        timedOut
          ? { kind: 'transient-error', error: 'Campaign sync timed out.', errorKind: 'network' }
          : null,
      );
    const timer = globalThis.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    controller.signal.addEventListener('abort', onAbort, { once: true });
    void operation.then(
      (attempt) => settle(attempt),
      (error: unknown) => settle(caughtAttempt(error)),
    );
  });
}
