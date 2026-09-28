import { logPopupWarn } from '../logging';

export type FarmingControlType = 'PAUSE_FARMING' | 'RESUME_FARMING' | 'STOP_FARMING';

const FARMING_CONTROL_FAILURE: Record<FarmingControlType, string> = {
  PAUSE_FARMING: 'Unable to pause farming.',
  RESUME_FARMING: 'Unable to resume farming.',
  STOP_FARMING: 'Unable to stop farming.',
};

export async function runFarmingControlRequest(
  type: FarmingControlType,
  send: (message: {
    readonly type: FarmingControlType;
  }) => Promise<{ readonly success: boolean; readonly error?: string } | null | undefined>,
): Promise<string | null> {
  try {
    const response = await send({ type });
    return response?.success ? null : (response?.error ?? FARMING_CONTROL_FAILURE[type]);
  } catch (error: unknown) {
    logPopupWarn(`${type} failed:`, error instanceof Error ? error : String(error));
    return FARMING_CONTROL_FAILURE[type];
  }
}
