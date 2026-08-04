import type { AppState, AutomationActivityEntry } from '../types/index.ts';

const MAX_AUTOMATION_ACTIVITY = 20;

export function recordAutomationActivity(state: AppState, entry: AutomationActivityEntry): void {
  state.automationActivity = [entry, ...state.automationActivity]
    .sort((left, right) => right.at - left.at)
    .slice(0, MAX_AUTOMATION_ACTIVITY);
  state.lastAutomationMessage = entry.message;
}
