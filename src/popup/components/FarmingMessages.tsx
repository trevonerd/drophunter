import { farmingMessages } from '../../shared/farming-messages.ts';
import type { AppState } from '../../types/index.ts';
import { CloseIcon } from './icons';

export function FarmingMessages({
  state,
  onDismiss,
}: {
  readonly state: AppState;
  readonly onDismiss: (id: string) => void;
}) {
  const messages = farmingMessages(state);
  const warnings = messages.filter((message) => message.kind === 'warning');
  const information = messages.filter((message) => message.kind === 'info');
  if (messages.length === 0) return null;
  const row = (message: (typeof messages)[number]) => (
    <li key={message.id} className="flex items-start gap-2 py-1.5">
      <p className="min-w-0 flex-1 break-words text-[11px] leading-snug text-[color:var(--dh-text-soft)]">
        {message.text}
      </p>
      <button
        type="button"
        className="dh-icon-button dh-focus shrink-0"
        aria-label="Dismiss farming message"
        title="Dismiss message"
        onClick={() => onDismiss(message.id)}
      >
        <CloseIcon />
      </button>
    </li>
  );
  return (
    <section
      className="dh-contain rounded-lg border border-[color:var(--dh-border)] px-2.5 py-1"
      aria-label="Farming messages"
    >
      <div role="status" aria-live="polite">
        {information.length > 0 && <ul>{information.map(row)}</ul>}
        {warnings.length > 0 && (
          <details>
            <summary className="dh-focus cursor-pointer py-1.5 text-[11px] font-semibold text-[color:var(--dh-text-soft)]">
              Campaign warnings ({warnings.length})
            </summary>
            <ul>{warnings.map(row)}</ul>
          </details>
        )}
      </div>
    </section>
  );
}
