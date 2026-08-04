export function TwitchSessionGate({
  queueCount,
  onOpenTwitch,
}: {
  readonly queueCount: number;
  readonly onOpenTwitch: () => void;
}) {
  return (
    <section
      className="dh-contain rounded-lg border border-purple-500/40 bg-purple-500/10 px-3 py-3"
      aria-labelledby="twitch-session-gate-heading"
      data-session-priority="twitch-required"
    >
      <h2 id="twitch-session-gate-heading" className="dh-title text-xs text-purple-200">
        Twitch session required
      </h2>
      <p className="mt-1 text-[11px] leading-snug text-[color:var(--dh-text-soft)]">
        Sign in to sync campaigns and farm Drops.
      </p>
      {queueCount > 0 && (
        <p className="mt-1 text-[10px] text-[color:var(--dh-muted)]" data-saved-queue-count={queueCount}>
          Your queue is saved ({queueCount} {queueCount === 1 ? 'campaign' : 'campaigns'}).
        </p>
      )}
      <button
        type="button"
        onClick={onOpenTwitch}
        className="dh-focus mt-2 inline-flex min-h-8 w-full items-center justify-center rounded-lg bg-twitch-purple/70 px-3 py-1.5 text-xs font-semibold text-[color:var(--dh-text)] transition-colors hover:bg-twitch-purple/75"
      >
        Open Twitch
      </button>
    </section>
  );
}
