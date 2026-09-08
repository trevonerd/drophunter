import type { AutomationEventNotifier } from './automation-event-notifier.ts';
import type { FarmingAutomationBrowser } from './farming-automation-browser.ts';
import type {
  FarmingAutomationOutcome,
  FarmingAutomationPersistence,
} from './farming-automation-contracts.ts';
import type { FarmingAutomationManualWatchController } from './farming-automation-manual-watch.ts';
import type { FarmingAutomationTwitchAdapter } from './farming-automation-twitch.ts';
import type { ServiceWorkerState } from './runtime-state.ts';

export type FarmingAutomationRuntime = { generation: number; snoozed: boolean };

export type FarmingAutomationEvaluatorDependencies = {
  readonly state: ServiceWorkerState;
  readonly persistence: FarmingAutomationPersistence;
  readonly browser: FarmingAutomationBrowser;
  readonly manualWatch: FarmingAutomationManualWatchController;
  readonly twitch: FarmingAutomationTwitchAdapter;
  readonly runtime: FarmingAutomationRuntime;
  readonly recover?: () => Promise<FarmingAutomationOutcome | null>;
  readonly now: () => number;
  readonly random: () => number;
  readonly onStarted?: () => void;
  readonly automationNotify?: AutomationEventNotifier;
};
