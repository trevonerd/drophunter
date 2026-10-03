export type FarmingAutomationWakeResult = 'scheduled' | 'cleared' | 'failed';

export interface FarmingAutomationWake {
  readonly replaceDeadline: (at: number | null) => Promise<FarmingAutomationWakeResult>;
}
