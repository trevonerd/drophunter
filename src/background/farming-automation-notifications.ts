import type { AutomationEventNotification, AutomationEventNotifier } from './automation-event-notifier.ts';

export function createFarmingAutomationNotificationBatch(notifier: AutomationEventNotifier | undefined) {
  const discoveries = new Map<string, AutomationEventNotification>();
  const startedCampaigns = new Set<string>();

  return {
    async notify(notification: AutomationEventNotification): Promise<void> {
      if (notification.event === 'discovery') {
        discoveries.set(notification.campaignId, notification);
        return;
      }
      if (notification.event === 'start' || notification.event === 'preemption') {
        startedCampaigns.add(notification.campaignId);
      }
      void Promise.resolve()
        .then(() => notifier?.notify(notification))
        .catch(() => undefined);
    },
    async flush(): Promise<void> {
      for (const notification of discoveries.values()) {
        if (!startedCampaigns.has(notification.campaignId))
          void Promise.resolve()
            .then(() => notifier?.notify(notification))
            .catch(() => undefined);
      }
      discoveries.clear();
    },
  };
}
