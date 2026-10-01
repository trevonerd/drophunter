export function SettingsBackupFeedback({
  loading,
  error,
  status,
}: {
  loading: boolean;
  error: string | null;
  status: string | null;
}) {
  return (
    <>
      {loading && (
        <p role="status" aria-live="polite" className="dh-copy text-[11px]">
          Preparing backup preview…
        </p>
      )}
      {error && (
        <p role="status" aria-live="polite" className="text-[11px] text-red-300">
          {error}
        </p>
      )}
      {status && (
        <p role="status" aria-live="polite" className="text-[11px] text-green-300">
          {status}
        </p>
      )}
    </>
  );
}
