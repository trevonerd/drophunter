import type { queueRecoveryNotice } from '../../shared/queue-recovery-notice.ts';
import { CloseIcon } from './icons';

interface QueueCleanupNoticeProps {
  readonly summary?: string;
  readonly message?: string;
  readonly entries?: ReturnType<typeof queueRecoveryNotice>;
  readonly onDismiss?: () => void;
}

export function QueueCleanupNotice({
  summary = 'Queue updated',
  message,
  entries,
  onDismiss,
}: QueueCleanupNoticeProps) {
  return (
    <section
      className="dh-contain rounded-lg border border-yellow-500/35 bg-yellow-500/10 px-2.5 py-1"
      aria-label="Queue campaign update"
    >
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1" role="status" aria-live="polite" aria-atomic="true">
          <details>
            <summary className="dh-focus cursor-pointer py-1.5 text-[11px] font-semibold text-[color:var(--dh-text-soft)]">
              {summary}
            </summary>
            {message && (
              <p className="mb-1 mt-0.5 text-[10px] leading-snug text-[color:var(--dh-text-soft)]">
                {message}
              </p>
            )}
            {entries && (
              <ul className="mb-1 space-y-2 text-[10px] leading-snug text-[color:var(--dh-text-soft)]">
                {entries.map((entry) => (
                  <li key={entry.key} className="break-words">
                    <p className="font-semibold">{entry.label}</p>
                    <p>
                      {entry.reason} · {entry.retry}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </details>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="dh-icon-button dh-focus shrink-0 text-[color:var(--dh-muted)] hover:text-[color:var(--dh-text)]"
            aria-label="Dismiss queue update"
            title="Dismiss queue update"
          >
            <CloseIcon />
          </button>
        )}
      </div>
    </section>
  );
}
