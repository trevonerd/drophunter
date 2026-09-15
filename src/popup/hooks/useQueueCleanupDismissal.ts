import { useCallback, useState } from 'react';
import { logPopupWarn } from '../logging';

const STORAGE_KEY = 'dismissedQueueCleanupActivityId';

function readDismissedActivityId(): string | null {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
  } catch (error: unknown) {
    logPopupWarn(
      'Unable to read the dismissed queue update:',
      error instanceof Error ? error : String(error),
    );
    return null;
  }
}

export function useQueueCleanupDismissal() {
  const [dismissedActivityId, setDismissedActivityId] = useState(readDismissedActivityId);

  const dismissQueueCleanup = useCallback((activityId: string) => {
    setDismissedActivityId(activityId);
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, activityId);
    } catch (error: unknown) {
      logPopupWarn(
        'Unable to remember the dismissed queue update:',
        error instanceof Error ? error : String(error),
      );
    }
  }, []);

  return {
    dismissedQueueCleanupActivityId: dismissedActivityId,
    handleDismissQueueCleanup: dismissQueueCleanup,
  };
}
