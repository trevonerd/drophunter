import { useState } from 'react';
import { type FarmingControlType, runFarmingControlRequest } from '../popup/hooks/farming-control-action.ts';
import { sendRuntimeMessage } from '../shared/messages.ts';
import type { AppState } from '../types/index.ts';

export function FarmingControls({ state }: { readonly state: AppState }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!state.isRunning && !state.isPaused) return null;
  const run = async (type: FarmingControlType) => {
    if (busy) return;
    setBusy(true);
    setError(await runFarmingControlRequest(type, sendRuntimeMessage));
    setBusy(false);
  };
  return (
    <section aria-label="Farming controls" className="monitor-controls">
      <button
        type="button"
        disabled={busy}
        onClick={() => void run(state.isPaused ? 'RESUME_FARMING' : 'PAUSE_FARMING')}
      >
        {state.isPaused ? 'Resume' : 'Pause'}
      </button>
      <button type="button" disabled={busy} onClick={() => void run('STOP_FARMING')}>
        Stop
      </button>
      {error && <p role="status">{error}</p>}
    </section>
  );
}
