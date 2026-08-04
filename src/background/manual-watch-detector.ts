import type { TwitchGame } from '../types/index.ts';
import {
  classifyManualWatch,
  type ManualWatchClassification,
  type PassiveViewingTelemetry,
} from './manual-watch-policy.ts';

export interface ManualWatchTab {
  readonly id?: number;
  readonly active?: boolean;
  readonly url?: string;
}

export interface ManualStreamContext {
  readonly channelName?: string | null;
  readonly categorySlug?: string | null;
  readonly category?: string | null;
  readonly isLive?: boolean;
  readonly isPlaybackReady?: boolean;
  readonly hasDropsEnabled?: boolean;
  readonly hasDropsSignal?: boolean;
}

export interface ManualViewingDetectionOptions {
  readonly target: TwitchGame;
  readonly managedTabId: number | null;
  readonly automationActive: boolean;
  readonly now: number;
  readonly queryTabs: () => Promise<readonly ManualWatchTab[]>;
  readonly getStreamContext: (tabId: number) => Promise<ManualStreamContext | null>;
}

function normalized(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function isTwitchUrl(url: string | undefined): boolean {
  return Boolean(url && /^https?:\/\/([^/]*\.)?twitch\.tv\//i.test(url));
}

function toTelemetry(
  target: TwitchGame,
  context: ManualStreamContext,
  automationActive: boolean,
  observedAt: number,
): PassiveViewingTelemetry {
  const allowedChannels = target.allowedChannels;
  const channelEligible =
    allowedChannels == null ||
    allowedChannels.length === 0 ||
    allowedChannels.some((channel) => normalized(channel) === normalized(context.channelName));
  const targetCategory = normalized(target.categorySlug ?? target.name);
  const observedCategory = normalized(context.categorySlug ?? context.category);
  return {
    observedAt,
    isVisible: true,
    isTwitch: true,
    isPlaybackReady: context.isPlaybackReady === true,
    channelEligible,
    categoryEligible: targetCategory.length > 0 && targetCategory === observedCategory,
    campaignEligible:
      context.isLive === true && (context.hasDropsEnabled === true || context.hasDropsSignal === true),
    automationActive,
  };
}

export async function detectManualViewing(
  options: ManualViewingDetectionOptions,
): Promise<ManualWatchClassification> {
  let tabs: readonly ManualWatchTab[];
  try {
    tabs = await options.queryTabs();
  } catch {
    return classifyManualWatch(null, options.now);
  }
  let ineligibleTelemetry: PassiveViewingTelemetry | null = null;

  for (const tab of tabs) {
    if (
      typeof tab.id !== 'number' ||
      tab.id === options.managedTabId ||
      tab.active !== true ||
      !isTwitchUrl(tab.url)
    ) {
      continue;
    }
    const context = await options.getStreamContext(tab.id).catch(() => null);
    if (!context) {
      continue;
    }
    const telemetry = toTelemetry(options.target, context, options.automationActive, options.now);
    const classification = classifyManualWatch(telemetry, options.now);
    if (classification.kind === 'eligible-manual') {
      return classification;
    }
    ineligibleTelemetry = telemetry;
  }

  return classifyManualWatch(ineligibleTelemetry, options.now);
}
