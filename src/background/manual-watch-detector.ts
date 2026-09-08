import { getFarmableTwitchChannelNameFromUrl } from '../shared/twitch-url.ts';
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

export type ManualViewingDetectionResult =
  | ManualWatchClassification
  | { readonly kind: 'failed'; readonly reason: 'observation-unavailable' };

function normalized(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
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
): Promise<ManualViewingDetectionResult> {
  let tabs: readonly ManualWatchTab[];
  try {
    tabs = await options.queryTabs();
  } catch {
    return { kind: 'failed', reason: 'observation-unavailable' };
  }
  let activeClassification: ManualWatchClassification | null = null;

  for (const tab of tabs) {
    if (
      typeof tab.id !== 'number' ||
      tab.id === options.managedTabId ||
      getFarmableTwitchChannelNameFromUrl(tab.url) === null
    ) {
      continue;
    }
    let context: ManualStreamContext | null;
    try {
      context = await options.getStreamContext(tab.id);
    } catch {
      return { kind: 'failed', reason: 'observation-unavailable' };
    }
    if (context === null) return { kind: 'failed', reason: 'observation-unavailable' };
    const telemetry = toTelemetry(options.target, context, options.automationActive, options.now);
    const classification = classifyManualWatch(telemetry, options.now);
    switch (classification.kind) {
      case 'eligible-manual':
        return classification;
      case 'automation-paused':
        activeClassification ??= classification;
        break;
      case 'inactive':
        break;
      default: {
        const unreachable: never = classification;
        throw new DOMException(
          `Unexpected manual-watch classification: ${String(unreachable)}`,
          'InvariantError',
        );
      }
    }
  }

  return activeClassification ?? classifyManualWatch(null, options.now);
}
