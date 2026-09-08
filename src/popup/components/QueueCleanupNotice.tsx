interface QueueCleanupNoticeProps {
  readonly message: string;
}

export function QueueCleanupNotice({ message }: QueueCleanupNoticeProps) {
  return (
    <section
      className="dh-contain rounded-lg border border-yellow-500/35 bg-yellow-500/10 px-2.5 py-2"
      aria-label="Queue campaign update"
      role="status"
      aria-live="polite"
    >
      <details>
        <summary className="dh-focus cursor-pointer text-[11px] font-semibold text-[color:var(--dh-text-soft)]">
          Queue updated
        </summary>
        <p className="mt-1 text-[10px] leading-snug text-[color:var(--dh-text-soft)]">{message}</p>
      </details>
    </section>
  );
}
