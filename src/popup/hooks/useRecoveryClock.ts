// Extracted from src/popup/App.tsx (recovery countdown clock).
import { useEffect, useState } from 'react';
import type { RuntimeMode } from '../../shared/runtime-status';

export function useRecoveryClock(runtimeMode: RuntimeMode) {
  const [recoveryNow, setRecoveryNow] = useState(Date.now());

  useEffect(() => {
    if (runtimeMode !== 'recovering') {
      return;
    }
    setRecoveryNow(Date.now());
    const timer = window.setInterval(() => setRecoveryNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [runtimeMode]);

  return recoveryNow;
}
